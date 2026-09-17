import os
import io
import logging
import pandas as pd
import time
from sqlalchemy import create_engine, text
from azure.storage.blob import BlobServiceClient
from sqlalchemy.exc import SQLAlchemyError
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

script_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.abspath(os.path.join(script_dir, "..", "..", "frontend", ".env.local"))

if os.path.exists(env_path):
    logging.info(f"Carregando .env local em: {env_path}")
    load_dotenv(env_path)
else:
    logging.info("Arquivo .env.local não encontrado localmente. Utilizando variáveis de ambiente do sistema/GitHub Secrets.")

def get_latest_silver_parquet(conn_str):
    """Encontra e faz o download do arquivo Parquet mais recente da camada Silver."""
    blob_service_client = BlobServiceClient.from_connection_string(conn_str)
    container_client = blob_service_client.get_container_client("silver")

    blobs = list(container_client.list_blobs(name_starts_with="facts/"))
    if not blobs:
        raise FileNotFoundError("Nenhum arquivo parquet encontrado em silver/facts/")

    latest_blob = sorted(blobs, key=lambda b: b.creation_time, reverse=True)[0]
    logging.info(f"Lendo o arquivo mais recente: {latest_blob.name}")

    blob_client = container_client.get_blob_client(latest_blob.name)
    download_stream = blob_client.download_blob()

    return pd.read_parquet(io.BytesIO(download_stream.readall()))


def main():
    azure_conn_str = os.getenv("AZURE_CONNECTION_STRING")
    # Lendo a mesma variável que o Next.js usa
    sql_conn_str = os.getenv("DATABASE_URL")

    if not azure_conn_str or not sql_conn_str:
        logging.error("Variáveis de ambiente (Connection Strings) ausentes. Verifique seu .env")
        return

    # Adaptador Inteligente: O Next.js usa 'postgresql://', mas o Python precisa do 'psycopg2'
    if sql_conn_str.startswith("postgresql://"):
        sql_conn_str = sql_conn_str.replace("postgresql://", "postgresql+psycopg2://")

    # 1. Puxar os dados processados do Data Lake
    df = get_latest_silver_parquet(azure_conn_str)

    # 2. Conectar ao PostgreSQL (Supabase)
    engine = create_engine(
        sql_conn_str,
        # fast_executemany é do SQL Server, no Postgres não precisamos disso
        connect_args={'connect_timeout': 90}
    )

    # --- PING DE CONEXÃO ---
    logging.info("Testando conexão com o Supabase...")
    for attempt in range(3):
        try:
            with engine.connect() as test_conn:
                test_conn.execute(text("SELECT 1"))
            logging.info("Conexão com PostgreSQL estabelecida com sucesso!")
            break
        except SQLAlchemyError as e:
            logging.warning(f"Falha na conexão. Aguardando 10 segundos (Tentativa {attempt + 1}/3)... Erro: {e}")
            time.sleep(10)
    else:
        raise Exception("Não foi possível conectar ao banco após 3 tentativas.")

    # 3. Preparar Dimensões
    dim_skins = df[['tradeup_id', 'skin']].drop_duplicates().rename(columns={'skin': 'skin_name'})
    dim_markets = df[['market']].drop_duplicates().rename(columns={'market': 'market_name'})

    with engine.begin() as conn:
        # Atualiza dim_markets
        existing_markets = pd.read_sql("SELECT market_name FROM dim_markets", conn)
        new_markets = dim_markets[~dim_markets['market_name'].isin(existing_markets['market_name'])]
        if not new_markets.empty:
            new_markets.to_sql('dim_markets', conn, if_exists='append', index=False)
            logging.info(f"{len(new_markets)} novos mercados adicionados.")

        # Atualiza dim_skins
        existing_skins = pd.read_sql("SELECT tradeup_id FROM dim_skins", conn)
        new_skins = dim_skins[~dim_skins['tradeup_id'].isin(existing_skins['tradeup_id'])]
        if not new_skins.empty:
            new_skins.to_sql('dim_skins', conn, if_exists='append', index=False)
            logging.info(f"{len(new_skins)} novas skins adicionadas.")

        # 4. Preparar e Atualizar Fatos
        fact_df = df[['tradeup_id', 'wear', 'market', 'price', 'timestamp']].copy()
        fact_df.rename(columns={'market': 'market_name', 'timestamp': 'extraction_timestamp'}, inplace=True)

        logging.info("Limpando preços antigos no banco de dados com TRUNCATE...")
        conn.execute(text("TRUNCATE TABLE fact_current_prices"))

        logging.info("Inserindo os preços atuais atualizados...")
        # Note que a coluna 'extraction_timestamp' foi removida nas novas tabelas do Postgres
        # Portanto, não enviamos ela no to_sql para evitar erro de coluna inexistente
        current_prices_df = fact_df[['tradeup_id', 'wear', 'market_name', 'price']]
        current_prices_df.to_sql('fact_current_prices', conn, if_exists='append', index=False, chunksize=2000)

        logging.info("Iniciando roteamento de snapshots de histórico...")

        current_time = pd.Timestamp.now()
        current_date_str = current_time.strftime('%Y-%m-%d')

        history_df = fact_df[['tradeup_id', 'wear', 'market_name', 'price']].copy()
        history_df['date_id'] = current_date_str

        # 1. SNAPSHOT DIÁRIO (Retenção: 30 dias)
        conn.execute(text(f"DELETE FROM fact_history_daily WHERE date_id = '{current_date_str}'"))
        history_df.to_sql('fact_history_daily', conn, if_exists='append', index=False, chunksize=2000)
        conn.execute(text("DELETE FROM fact_history_daily WHERE date_id < CURRENT_DATE - INTERVAL '30 days'"))

        # 2. SNAPSHOT SEMANAL (Domingos | Retenção: 365 dias)
        if current_time.dayofweek == 6:  # No Pandas, 6 = Domingo
            logging.info("Domingo detectado: Atualizando snapshot semanal...")
            conn.execute(text(f"DELETE FROM fact_history_weekly WHERE date_id = '{current_date_str}'"))
            history_df.to_sql('fact_history_weekly', conn, if_exists='append', index=False, chunksize=2000)
            conn.execute(text("DELETE FROM fact_history_weekly WHERE date_id < CURRENT_DATE - INTERVAL '365 days'"))

        # 3. SNAPSHOT MENSAL (Dia 1º | Retenção: 5 anos)
        if current_time.day == 1:
            logging.info("Dia 1º detectado: Atualizando snapshot mensal...")
            conn.execute(text(f"DELETE FROM fact_history_monthly WHERE date_id = '{current_date_str}'"))
            history_df.to_sql('fact_history_monthly', conn, if_exists='append', index=False, chunksize=2000)
            conn.execute(text("DELETE FROM fact_history_monthly WHERE date_id < CURRENT_DATE - INTERVAL '5 years'"))

        # 4. SNAPSHOT ANUAL (1º de Janeiro | Retenção: 10 anos)
        if current_time.day == 1 and current_time.month == 1:
            logging.info("1º de Janeiro detectado: Atualizando snapshot anual...")
            conn.execute(text(f"DELETE FROM fact_history_yearly WHERE date_id = '{current_date_str}'"))
            history_df.to_sql('fact_history_yearly', conn, if_exists='append', index=False, chunksize=2000)
            conn.execute(text("DELETE FROM fact_history_yearly WHERE date_id < CURRENT_DATE - INTERVAL '10 years'"))

    logging.info("Carga da Camada Gold (Supabase) concluída com sucesso!")


if __name__ == "__main__":
    main()