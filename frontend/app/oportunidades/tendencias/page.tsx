import { getConnection } from '../../../lib/db';
import { getCurrencyInfo, formatPrice } from '../../../lib/currency';
import Link from 'next/link';
import FiltersTendencias from './Filters';

export default async function TendenciasPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;

  const minPrice = parseFloat((params.minPrice as string) || '5');
  const maxPrice = parseFloat((params.maxPrice as string) || '2000');
  const minGrowth = parseFloat((params.minGrowth as string) || '5');
  const category = (params.category as string) || 'normal';

  const page = parseInt((params.page as string) || '1');
  const pageSize = 30;
  const offset = (page - 1) * pageSize;

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
      SELECT tradeup_id, wear, AVG(price) as avg_history
      FROM fact_history_daily
      WHERE market_name LIKE '%Steam%'
        AND date_id >= (CURRENT_DATE - INTERVAL '30 days')::date
      GROUP BY tradeup_id, wear
    ),
    CurrentSteam AS (
      SELECT tradeup_id, wear, price AS current_price
      FROM fact_current_prices
      WHERE market_name LIKE '%Steam%'
    ),
    Trends AS (
      SELECT 
        c.tradeup_id,
        c.wear,
        c.current_price,
        h.avg_history,
        ((c.current_price - h.avg_history) / h.avg_history) * 100.0 AS growth_pct
      FROM CurrentSteam c
      JOIN HistoryStats h 
        ON c.tradeup_id::text = h.tradeup_id::text 
        AND c.wear::text = h.wear::text
      WHERE h.avg_history > 0 
        AND c.current_price >= $1 
        AND c.current_price <= $2
        ${categoryFilter}
    )
    SELECT 
      t.tradeup_id,
      d.skin_name,
      d.image_url,
      t.wear,
      t.current_price::float AS avg_current,
      t.avg_history::float AS avg_previous,
      t.growth_pct::float AS growth_pct,
      (COUNT(*) OVER())::int AS total_items 
    FROM Trends t
    JOIN dim_skins d ON t.tradeup_id::text = d.tradeup_id::text
    WHERE t.growth_pct >= $3
    ORDER BY t.growth_pct DESC
    LIMIT $5 OFFSET $4 
  `, [minPrice, maxPrice, minGrowth, offset, pageSize]); // $1, $2, $3, $4, $5

  const skins = result.rows;
  const totalItems = skins.length > 0 ? skins[0].total_items : 0;
  const totalPages = Math.ceil(totalItems / pageSize);

  const buildPageUrl = (newPage: number) => {
    const newParams = new URLSearchParams(params as Record<string, string>);
    newParams.set('page', newPage.toString());
    return `?${newParams.toString()}`;
  };

  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-50 p-6 md:p-10 font-sans transition-colors">
      <div className="max-w-7xl mx-auto">

        <Link href="/oportunidades" className="text-orange-600 dark:text-orange-500 hover:text-orange-500 dark:hover:text-orange-400 mb-6 inline-block font-medium transition-colors">
          &larr; Voltar para Módulos
        </Link>

        <header className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold mb-3 text-orange-600 dark:text-orange-500">
              Tendências (Em Alta)
            </h1>
            <p className="text-neutral-600 dark:text-neutral-400 max-w-2xl">
              Monitorando o hype: Itens cujo preço atual na Steam está superando a média histórica dos últimos 30 dias.
            </p>
          </div>
          <div className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 px-4 py-2 rounded-lg font-mono text-sm font-semibold border border-orange-200 dark:border-orange-800/50">
            {totalItems} Itens Aquecidos
          </div>
        </header>

        <FiltersTendencias />

        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg shadow-xl transition-colors mb-8">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse min-w-max">
              <thead>
                <tr className="bg-neutral-100 dark:bg-neutral-950 border-b border-neutral-300 dark:border-neutral-800 transition-colors">
                  <th className="p-4 font-semibold text-neutral-700 dark:text-neutral-300">Item</th>
                  {/* Títulos ajustados para refletir a nova lógica */}
                  <th className="p-4 font-semibold text-neutral-700 dark:text-neutral-300">Média Histórica</th>
                  <th className="p-4 font-semibold text-neutral-700 dark:text-neutral-300">Preço Steam (Hoje)</th>
                  <th className="p-4 font-semibold text-neutral-700 dark:text-neutral-300 text-right">Crescimento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/50">
                {skins.map((skin, index) => {
                  const isST = skin.wear?.startsWith('ST ');
                  const isSv = skin.wear?.startsWith('Sv ') || skin.wear?.startsWith('Souvenir ');
                  const cleanWear = skin.wear?.replace(/^(ST |Sv |Souvenir )/, '');

                  const isVeryHot = skin.growth_pct >= 15;

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
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-neutral-900 dark:text-neutral-100">{skin.skin_name}</span>
                              {isVeryHot && (
                                <span className="bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase border border-red-200 dark:border-red-800/50">
                                  🔥 Quente
                                </span>
                              )}
                            </div>
                            <div className="text-xs mt-1">
                              {isST && <span className="text-orange-500 dark:text-orange-400 font-bold mr-1">ST</span>}
                              {isSv && <span className="text-yellow-500 dark:text-yellow-400 font-bold mr-1">Sv</span>}
                              <span className="text-neutral-500 dark:text-neutral-400">{cleanWear || '-'}</span>
                            </div>
                          </div>
                        </Link>
                      </td>

                      <td className="p-4">
                        <span className="text-neutral-500 dark:text-neutral-400 font-mono text-sm">
                          {formatPrice(skin.avg_previous, rate, symbol)}
                        </span>
                      </td>

                      <td className="p-4 text-orange-600 dark:text-orange-400 font-mono font-bold text-lg">
                        {formatPrice(skin.avg_current, rate, symbol)}
                      </td>

                      <td className="p-4 text-right">
                        <div className="inline-flex flex-col items-end">
                          <span className="bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400 px-3 py-1 rounded-full text-sm font-bold border border-orange-200 dark:border-orange-500/30">
                            +{skin.growth_pct.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {skins.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-12 text-center text-neutral-500 dark:text-neutral-400">
                      Nenhuma tendência de alta encontrada com os filtros atuais.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="p-4 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between bg-neutral-50 dark:bg-neutral-900/50 rounded-b-lg">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">
                Página <span className="font-bold text-neutral-900 dark:text-white">{page}</span> de <span className="font-bold text-neutral-900 dark:text-white">{totalPages}</span>
              </span>

              <div className="flex gap-2">
                <Link
                  href={page > 1 ? buildPageUrl(page - 1) : '#'}
                  className={`px-4 py-2 text-sm font-medium rounded-md border transition-colors ${
                    page > 1 
                    ? 'bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700' 
                    : 'bg-neutral-100 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-400 dark:text-neutral-600 cursor-not-allowed pointer-events-none'
                  }`}
                >
                  Anterior
                </Link>

                <Link
                  href={page < totalPages ? buildPageUrl(page + 1) : '#'}
                  className={`px-4 py-2 text-sm font-medium rounded-md border transition-colors ${
                    page < totalPages 
                    ? 'bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700' 
                    : 'bg-neutral-100 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-400 dark:text-neutral-600 cursor-not-allowed pointer-events-none'
                  }`}
                >
                  Próxima
                </Link>
              </div>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}