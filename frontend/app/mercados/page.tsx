import { getConnection } from "../../lib/db";
import MarketTooltip from "../components/MarketTooltip";

export default async function MercadosPage() {
  const pool = await getConnection();

  const result = await pool.query(`
    SELECT 
      CASE 
        WHEN market_name = 'market_37' THEN 'Skin.Land' 
        ELSE market_name 
      END AS market_name,
      logo_url
    FROM dim_markets
    ORDER BY market_name ASC
  `);

  const mercados = result.rows;

  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950 p-6 md:p-12 transition-colors">
      <div className="max-w-6xl mx-auto">
        <header className="mb-12 text-center md:text-left">
          <h1 className="text-4xl font-extrabold text-neutral-900 dark:text-white mb-4">Mercados Integrados</h1>
          <p className="text-neutral-600 dark:text-neutral-400 text-lg max-w-2xl">
            Nossa engine de dados raspa e consolida os preços destas plataformas diariamente para garantir que você não perca nenhuma oferta.
          </p>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {mercados.map((mercado) => (
            <div key={mercado.market_name} className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 flex flex-col items-center justify-center shadow-md hover:shadow-lg transition-shadow">

              {mercado.logo_url ? (
                <MarketTooltip marketName={mercado.market_name}>
                  <img
                    src={mercado.logo_url}
                    alt={mercado.market_name}
                    className="h-12 w-auto mx-auto object-contain transition-all drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
                  />
                </MarketTooltip>
              ) : (
                <div className="h-12 w-12 bg-neutral-200 dark:bg-neutral-800 rounded-full mb-4"></div>
              )}

              <span className="font-semibold text-neutral-800 dark:text-neutral-200 uppercase tracking-wide text-sm text-center mt-4">
                {mercado.market_name}
              </span>

            </div>
          ))}
        </div>
      </div>
    </main>
  );
}