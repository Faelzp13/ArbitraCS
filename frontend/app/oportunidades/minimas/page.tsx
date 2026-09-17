import { getConnection } from '../../../lib/db';
import { getCurrencyInfo, formatPrice } from '../../../lib/currency';
import Link from 'next/link';
import FiltersMinimas from './Filters';
import MarketTooltip from '../../components/MarketTooltip'; // Importando o tooltip

export default async function MinimasPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;

  const minPrice = parseFloat((params.minPrice as string) || '15');
  const maxPrice = parseFloat((params.maxPrice as string) || '2000');
  const category = (params.category as string) || 'normal';

  const pool = await getConnection();
  const { rate, symbol } = await getCurrencyInfo();

  let categoryFilter = "";
  if (category === 'normal') {
    categoryFilter = "AND c.wear NOT LIKE 'ST %' AND c.wear NOT LIKE 'Sv %' AND c.wear NOT LIKE 'Souvenir %'";
  } else if (category === 'st') {
    categoryFilter = "AND c.wear LIKE 'ST %'";
  } else if (category === 'sv') {
    categoryFilter = "AND (c.wear LIKE 'Sv %' OR c.wear LIKE 'Souvenir %')";
  }

  const result = await pool.query(`
    WITH HistoryStats AS (
      SELECT tradeup_id, wear, MIN(price) as min_price_30d, AVG(price) as avg_price_30d
      FROM fact_history_daily
      WHERE date_id >= (CURRENT_DATE - INTERVAL '30 days')::date
      GROUP BY tradeup_id, wear
    ),
    CurrentPrices AS (
      SELECT tradeup_id, wear, market_name, price
      FROM fact_current_prices
    ),
    RankedLows AS (
      SELECT 
        c.tradeup_id,
        c.wear,
        c.market_name,
        c.price,
        h.min_price_30d,
        h.avg_price_30d,
        ((h.avg_price_30d - c.price) / h.avg_price_30d) * 100 AS drop_pct,
        ROW_NUMBER() OVER(PARTITION BY c.tradeup_id, c.wear ORDER BY c.price ASC) as rn
      FROM CurrentPrices c
      JOIN HistoryStats h 
        ON c.tradeup_id::text = h.tradeup_id::text 
        AND c.wear::text = h.wear::text
      WHERE c.price > 0 
        AND c.price <= h.min_price_30d 
        AND h.avg_price_30d >= $1 
        AND h.avg_price_30d <= $2
        ${categoryFilter}
    )
    SELECT 
      r.tradeup_id,
      d.skin_name,
      d.image_url,
      r.wear,
      r.market_name,
      m.logo_url,
      r.price::float AS price,
      r.min_price_30d::float AS min_price_30d,
      r.avg_price_30d::float AS avg_price_30d,
      r.drop_pct::float AS drop_pct
    FROM RankedLows r
    JOIN dim_skins d ON r.tradeup_id::text = d.tradeup_id::text
    LEFT JOIN dim_markets m ON r.market_name::text = m.market_name::text
    WHERE r.rn = 1 
    ORDER BY r.drop_pct DESC
    LIMIT 50
  `, [minPrice, maxPrice]);

  const skins = result.rows;

  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-50 p-6 md:p-10 font-sans transition-colors">
      <div className="max-w-7xl mx-auto">

        <Link href="/oportunidades" className="text-blue-600 dark:text-blue-500 hover:text-blue-500 dark:hover:text-blue-400 mb-6 inline-block font-medium transition-colors">
          &larr; Voltar para Módulos
        </Link>

        <header className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold mb-3 text-blue-600 dark:text-blue-500">
              Mínimas Históricas
            </h1>
            <p className="text-neutral-600 dark:text-neutral-400 max-w-2xl">
              Estas skins atingiram o <strong>menor preço registrado nos últimos 30 dias</strong> neste exato momento. Oportunidades raras para compra e retenção no inventário.
            </p>
          </div>
          <div className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-4 py-2 rounded-lg font-mono text-sm font-semibold border border-blue-200 dark:border-blue-800/50">
            {skins.length} Mínimas Encontradas
          </div>
        </header>

        <FiltersMinimas />

        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-x-auto shadow-xl transition-colors custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-max">
            <thead>
              <tr className="bg-neutral-100 dark:bg-neutral-950 border-b border-neutral-300 dark:border-neutral-800 transition-colors">
                <th className="p-4 font-semibold text-neutral-700 dark:text-neutral-300">Item</th>
                <th className="p-4 font-semibold text-neutral-700 dark:text-neutral-300 text-center">Onde Comprar</th>
                <th className="p-4 font-semibold text-neutral-700 dark:text-neutral-300">Média (30 Dias)</th>
                <th className="p-4 font-semibold text-neutral-700 dark:text-neutral-300 text-blue-600 dark:text-blue-500">Preço Atual (Mínima)</th>
                <th className="p-4 font-semibold text-neutral-700 dark:text-neutral-300 text-right">Queda da Média</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/50">
              {skins.map((skin, index) => {
                const isST = skin.wear?.startsWith('ST ');
                const isSv = skin.wear?.startsWith('Sv ') || skin.wear?.startsWith('Souvenir ');
                const cleanWear = skin.wear?.replace(/^(ST |Sv |Souvenir )/, '');
                const savings = skin.avg_price_30d - skin.price;

                return (
                  <tr key={`${skin.tradeup_id}-${index}`} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition-colors group">
                    <td className="p-4">
                      <Link href={`/skin/${skin.tradeup_id}`} className="flex items-center gap-4 group-hover:opacity-80 transition-opacity">
                        {skin.image_url ? (
                          <img src={skin.image_url} alt={skin.skin_name} className="w-16 h-12 object-contain bg-neutral-100 dark:bg-neutral-800/50 rounded drop-shadow-md" />
                        ) : (
                          <div className="w-16 h-12 bg-neutral-200 dark:bg-neutral-800 rounded flex items-center justify-center text-[10px] text-neutral-500">Sem Foto</div>
                        )}
                        <div className="flex flex-col">
                          <span className="font-medium text-neutral-900 dark:text-neutral-100">{skin.skin_name}</span>
                          <div className="text-xs mt-1">
                            {isST && <span className="text-orange-500 dark:text-orange-400 font-bold mr-1">ST</span>}
                            {isSv && <span className="text-yellow-500 dark:text-yellow-400 font-bold mr-1">Sv</span>}
                            <span className="text-neutral-500 dark:text-neutral-400">{cleanWear || '-'}</span>
                          </div>
                        </div>
                      </Link>
                    </td>

                    <td className="p-4 text-center">
                      <MarketTooltip marketName={skin.market_name}>
                        {skin.logo_url ? (
                          <img
                            src={skin.logo_url}
                            alt={skin.market_name}
                            className="h-8 w-auto mx-auto object-contain transition-transform hover:scale-105 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
                          />
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wide bg-neutral-200/50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-300 dark:border-neutral-700">
                            {skin.market_name}
                          </span>
                        )}
                      </MarketTooltip>
                    </td>

                    <td className="p-4">
                      <span className="text-neutral-500 dark:text-neutral-400 font-mono text-sm line-through decoration-neutral-300 dark:decoration-neutral-600">
                        {formatPrice(skin.avg_price_30d, rate, symbol)}
                      </span>
                    </td>

                    <td className="p-4 text-blue-600 dark:text-blue-400 font-mono font-bold text-xl">
                      <div className="inline-flex items-center gap-2">
                        {formatPrice(skin.price, rate, symbol)}
                        <span className="relative flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                        </span>
                      </div>
                    </td>

                    <td className="p-4 text-right">
                      <div className="inline-flex flex-col items-end">
                        <span className="bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 px-3 py-1 rounded-full text-sm font-bold border border-blue-200 dark:border-blue-500/30">
                          -{skin.drop_pct.toFixed(1)}%
                        </span>
                        <span className="text-xs text-blue-600 dark:text-blue-400 mt-1 font-mono font-semibold">
                          Economia: {formatPrice(savings, rate, symbol)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {skins.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-neutral-500 dark:text-neutral-400">
                    Nenhum item em mínima histórica encontrado com os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>
    </main>
  );
}