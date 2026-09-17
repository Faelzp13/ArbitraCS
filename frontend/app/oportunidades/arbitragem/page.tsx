import { getConnection } from '../../../lib/db';
import { getCurrencyInfo, formatPrice } from '../../../lib/currency';
import Link from 'next/link';
import Filters from './Filters';
import MarketTooltip from '../../components/MarketTooltip';

export default async function ArbitragemPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;

  // Parâmetros extraídos da URL
  const minPrice = parseFloat((params.minPrice as string) || '15');
  const maxPrice = parseFloat((params.maxPrice as string) || '2000');
  const minDiscount = parseFloat((params.minDiscount as string) || '10');
  const maxDiscount = parseFloat((params.maxDiscount as string) || '70');
  const category = (params.category as string) || 'normal';

  const pool = getConnection();
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
    WITH CurrentSteam AS (
      SELECT tradeup_id, wear, price AS steam_price
      FROM fact_current_prices
      WHERE market_name LIKE '%Steam%'
    ),
    CurrentTP AS (
      SELECT tradeup_id, wear, market_name AS tp_market, price AS tp_price
      FROM fact_current_prices
      WHERE market_name NOT LIKE '%Steam%'
    ),
    RankedDeals AS (
      SELECT 
        c.tradeup_id,
        c.wear,
        c.tp_market,
        c.tp_price,
        s.steam_price,
        ((s.steam_price - c.tp_price) / s.steam_price) * 100 AS discount_pct,
        ROW_NUMBER() OVER(PARTITION BY c.tradeup_id, c.wear ORDER BY c.tp_price ASC) as rn
      FROM CurrentTP c
      JOIN CurrentSteam s 
        ON c.tradeup_id::text = s.tradeup_id::text 
        AND c.wear::text = s.wear::text
      WHERE s.steam_price >= $1 
        AND s.steam_price <= $2
        AND c.tp_price > 0 
        ${categoryFilter}
    )
    SELECT 
      r.tradeup_id,
      d.skin_name,
      d.image_url,
      r.wear,
      r.tp_market AS market_name,
      m.logo_url, 
      r.tp_price::float AS price,
      r.steam_price::float AS steam_price,
      r.discount_pct::float AS discount_pct
    FROM RankedDeals r
    JOIN dim_skins d 
      ON r.tradeup_id::text = d.tradeup_id::text
    LEFT JOIN dim_markets m 
      ON r.tp_market::text = m.market_name::text
    WHERE r.rn = 1 
      AND r.discount_pct >= $3 
      AND r.discount_pct <= $4
    ORDER BY r.discount_pct DESC
    LIMIT 50
  `, [minPrice, maxPrice, minDiscount, maxDiscount]);

  const skins = result.rows;

  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-50 p-6 md:p-10 font-sans transition-colors">
      <div className="max-w-7xl mx-auto">

        <Link href="/oportunidades" className="text-emerald-600 dark:text-emerald-500 hover:text-emerald-500 dark:hover:text-emerald-400 mb-6 inline-block font-medium transition-colors">
          &larr; Voltar para Módulos
        </Link>

        <header className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold mb-3 text-emerald-600 dark:text-emerald-500">
              Arbitragem Real
            </h1>
            <p className="text-neutral-600 dark:text-neutral-400 max-w-2xl">
              Compare os <strong>preços atuais</strong> entre mercados terceiros e a Steam. Utilize os filtros para remover anomalias e encontrar as melhores margens do momento.
            </p>
          </div>
          <div className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-4 py-2 rounded-lg font-mono text-sm font-semibold border border-emerald-200 dark:border-emerald-800/50">
            {skins.length} Oportunidades Encontradas
          </div>
        </header>

        <Filters />

        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-x-auto shadow-xl transition-colors custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-max">
            <thead>
              <tr className="bg-neutral-100 dark:bg-neutral-950 border-b border-neutral-300 dark:border-neutral-800 transition-colors">
                <th className="p-4 font-semibold text-neutral-700 dark:text-neutral-300">Item</th>
                <th className="p-4 font-semibold text-neutral-700 dark:text-neutral-300 text-center">Onde Comprar</th>
                <th className="p-4 font-semibold text-neutral-700 dark:text-neutral-300">Preço Steam (Atual)</th>
                <th className="p-4 font-semibold text-neutral-700 dark:text-neutral-300">Preço Agora</th>
                <th className="p-4 font-semibold text-neutral-700 dark:text-neutral-300 text-right">Desconto (Lucro)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/50">
              {skins.map((skin, index) => {
                const isST = skin.wear?.startsWith('ST ');
                const isSv = skin.wear?.startsWith('Sv ') || skin.wear?.startsWith('Souvenir ');
                const cleanWear = skin.wear?.replace(/^(ST |Sv |Souvenir )/, '');
                const profit = skin.steam_price - skin.price;

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
                      <div className="flex flex-col">
                        <span className="text-neutral-400 dark:text-neutral-500 line-through decoration-neutral-300 dark:decoration-neutral-600 decoration-2 font-mono text-sm">
                          {formatPrice(skin.steam_price, rate, symbol)}
                        </span>
                        <span className="text-[10px] text-neutral-500 font-semibold uppercase mt-0.5">Valor Atual</span>
                      </div>
                    </td>

                    <td className="p-4 text-emerald-600 dark:text-emerald-400 font-mono font-bold text-xl">
                      {formatPrice(skin.price, rate, symbol)}
                    </td>

                    <td className="p-4 text-right">
                      <div className="inline-flex flex-col items-end">
                        <span className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-3 py-1 rounded-full text-sm font-bold border border-emerald-200 dark:border-emerald-500/30">
                          {skin.discount_pct.toFixed(1)}% OFF
                        </span>
                        <span className="text-xs text-emerald-600 dark:text-emerald-500 mt-1 font-mono font-semibold bg-emerald-50 dark:bg-emerald-900/10 px-2 py-0.5 rounded">
                          +{formatPrice(profit, rate, symbol)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {skins.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-neutral-500 dark:text-neutral-400">
                    Nenhuma oportunidade encontrada com esses filtros. <br/> Tente aumentar o Desconto Máx ou reduzir o Preço Mínimo!
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