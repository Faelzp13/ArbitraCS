import { getConnection } from '../../../lib/db';
import Link from 'next/link';
import { getCurrencyInfo, formatPrice } from '../../../lib/currency';
import PriceHistoryChart from '../../components/PriceHistoryChart';
import SearchBar from '../../components/SearchBar';
import MarketTooltip from '../../components/MarketTooltip'; // Importando nosso componente

export default async function SkinPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const id = resolvedParams.id;
  const { code, rate, symbol } = await getCurrencyInfo();

  const pool = await getConnection();

  // Executamos as 4 queries simultaneamente no PostgreSQL para máximo desempenho
  const [skinRes, pricesRes, marketsRes, historyRes] = await Promise.all([
    pool.query(`
      SELECT skin_name, image_url 
      FROM dim_skins 
      WHERE tradeup_id = $1
    `, [id]),

    pool.query(`
      SELECT 
        CASE 
          WHEN market_name = 'market_37' THEN 'Skin.Land' 
          ELSE market_name 
        END AS market_name, 
        wear, 
        price::float AS price 
      FROM fact_current_prices 
      WHERE tradeup_id = $1
    `, [id]),

    pool.query(`
      SELECT 
        CASE 
          WHEN market_name = 'market_37' THEN 'Skin.Land' 
          ELSE market_name 
        END AS market_name, 
        logo_url AS image_url 
      FROM dim_markets
    `),

    pool.query(`
      SELECT date_id, wear, AVG(price)::float as avg_price 
      FROM fact_history_daily 
      WHERE tradeup_id = $1 
      GROUP BY date_id, wear 
      ORDER BY date_id ASC
    `, [id])
  ]);

  const skin = skinRes.rows[0];
  const prices = pricesRes.rows;
  const marketsRaw = marketsRes.rows;
  const historyRaw = historyRes.rows;

  const marketsInfo = marketsRaw.reduce((acc, curr) => {
    acc[curr.market_name] = curr.image_url;
    return acc;
  }, {} as Record<string, string>);

  // --- TRANSFORMAÇÃO DE DADOS PARA O RECHARTS ---
  const chartDataMap: Record<string, any> = {};

  historyRaw.forEach((row: any) => {
    // Tratamento dinâmico para date_id (suporta YYYYMMDD ou objetos Date do SQL)
    let formattedDate = '';
    const dId = row.date_id;

    if (typeof dId === 'number' || (typeof dId === 'string' && dId.toString().length === 8 && !dId.toString().includes('-'))) {
      const s = String(dId);
      formattedDate = `${s.substring(6, 8)}/${s.substring(4, 6)}`; // Converte 20260909 para 09/09
    } else if (dId instanceof Date) {
      formattedDate = dId.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    } else {
      formattedDate = String(dId);
    }

    if (!chartDataMap[formattedDate]) {
      chartDataMap[formattedDate] = { date: formattedDate };
    }

    // NORMALIZAÇÃO PARA O GRÁFICO: Transforma "Souvenir " em "Sv "
    let cleanWear = row.wear;
    if (cleanWear.startsWith('Souvenir ')) {
      cleanWear = cleanWear.replace('Souvenir ', 'Sv ');
    }

    // Alimenta o objeto com o preço médio do desgaste
    chartDataMap[formattedDate][cleanWear] = row.avg_price;
  });

  const chartData = Object.values(chartDataMap);

  if (!skin) {
    return (
      <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex flex-col items-center justify-center font-sans transition-colors">
        <h1 className="text-2xl text-neutral-600 dark:text-neutral-400 mb-4">Skin não encontrada.</h1>
        <Link href="/" className="text-emerald-600 dark:text-emerald-500 hover:text-emerald-500 dark:hover:text-emerald-400 underline transition-colors">Voltar</Link>
      </main>
    );
  }

  // --- LÓGICA DE NEGÓCIO ---

  // Atualizado para incluir as versões Souvenir (Sv / Souvenir) na ordenação
  const wearOrder = [
    'Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred',
    'ST Factory New', 'ST Minimal Wear', 'ST Field-Tested', 'ST Well-Worn', 'ST Battle-Scarred',
    'Sv Factory New', 'Sv Minimal Wear', 'Sv Field-Tested', 'Sv Well-Worn', 'Sv Battle-Scarred',
    'Souvenir Factory New', 'Souvenir Minimal Wear', 'Souvenir Field-Tested', 'Souvenir Well-Worn', 'Souvenir Battle-Scarred'
  ];
  const uniqueWears = Array.from(new Set(prices.map((p: any) => p.wear))) as string[];
  const wears = uniqueWears.sort((a, b) => {
    const indexA = wearOrder.indexOf(a), indexB = wearOrder.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1; if (indexB === -1) return -1;
    return indexA - indexB;
  });

  // Separação em três categorias (Normal, ST, Souvenir)
  const isST = (w: string) => w.startsWith('ST ');
  const isSv = (w: string) => w.startsWith('Sv ') || w.startsWith('Souvenir ');

  const normalWears = wears.filter(w => !isST(w) && !isSv(w));
  const stWears = wears.filter(w => isST(w));
  const svWears = wears.filter(w => isSv(w));

  const tableCategories = [];
  if (normalWears.length > 0) tableCategories.push({ wears: normalWears });
  if (stWears.length > 0) tableCategories.push({ wears: stWears });
  if (svWears.length > 0) tableCategories.push({ wears: svWears });

  const allMarkets = Array.from(new Set(prices.map((p: any) => p.market_name))) as string[];
  const steamName = allMarkets.find(m => m.toLowerCase().includes('steam'));
  const otherMarkets = allMarkets.filter(m => m !== steamName).sort();
  const sortedMarkets = steamName ? [steamName, ...otherMarkets] : otherMarkets;

  const priceMap: Record<string, Record<string, number>> = {};
  const minPrices: Record<string, number> = {};
  const avgPrices: Record<string, number> = {};

  wears.forEach(wear => {
    const wearPrices = prices.filter((p: any) => p.wear === wear);

    priceMap[wear] = {};
    wearPrices.forEach((p: any) => { priceMap[wear][p.market_name] = p.price; });

    const sum = wearPrices.reduce((acc, curr) => acc + curr.price, 0);
    avgPrices[wear] = wearPrices.length > 0 ? sum / wearPrices.length : 0;

    const validPricesForMin = wearPrices
      .filter((p: any) => p.market_name !== steamName)
      .map((p: any) => p.price);

    if (validPricesForMin.length > 0) {
      minPrices[wear] = Math.min(...validPricesForMin);
    }
  });

  // Função auxiliar para colorir o prefixo ST ou Sv e renderizar o nome do desgaste
  const renderWearName = (wear: string) => {
    if (isST(wear)) {
      return (
        <>
          <span className="text-orange-500 dark:text-orange-400 font-bold mr-1">ST</span>
          <span className="text-neutral-600 dark:text-neutral-400">{wear.replace('ST ', '')}</span>
        </>
      );
    }
    if (isSv(wear)) {
      const prefix = wear.startsWith('Sv ') ? 'Sv' : 'Souvenir';
      return (
        <>
          <span className="text-yellow-500 dark:text-yellow-400 font-bold mr-1">{prefix}</span>
          <span className="text-neutral-600 dark:text-neutral-400">{wear.replace(`${prefix} `, '')}</span>
        </>
      );
    }
    return <span className="text-neutral-600 dark:text-neutral-400">{wear}</span>;
  };

  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-50 p-10 font-sans transition-colors">
      <div className="max-w-7xl mx-auto">

        <div className="mb-8 w-full max-w-3xl mx-auto">
          <SearchBar />
        </div>

        {/* Topo Dividido: Imagem (Esquerda) e Média (Direita) */}
        <div className="flex flex-col lg:flex-row gap-8 mb-8">

          {/* Card da Imagem */}
          <div className="flex-1 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-10 flex flex-col items-center justify-center shadow-xl relative overflow-hidden transition-colors">
            <div className="absolute top-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-500 to-transparent opacity-50"></div>
            <h1 className="text-3xl font-bold mb-6 text-center text-neutral-900 dark:text-neutral-100">{skin.skin_name}</h1>
            {skin.image_url ? (
              <img src={skin.image_url} alt={skin.skin_name} className="w-full max-w-md h-auto object-contain drop-shadow-[0_0_25px_rgba(255,255,255,0.05)] hover:scale-105 transition-transform duration-500" />
            ) : (
              <div className="w-full max-w-md h-48 bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center text-neutral-500 rounded-lg">Sem Imagem</div>
            )}
          </div>

          {/* Card da Mini-tabela de Médias */}
          <div className="w-full lg:w-96 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg shadow-xl overflow-hidden flex flex-col transition-colors">
            <div className="bg-neutral-100 dark:bg-neutral-950 p-4 border-b border-neutral-200 dark:border-neutral-800 text-center font-semibold text-neutral-700 dark:text-neutral-300 transition-colors">
              Preço Médio Global
            </div>
            <div className="p-4 flex-1 overflow-y-auto custom-scrollbar">
              <table className="w-full text-sm">
                <tbody>
                  {wears.map(wear => (
                    <tr key={`avg-${wear}`} className="border-b border-neutral-200 dark:border-neutral-800/50 last:border-0 transition-colors">
                      <td className="py-3 font-medium">
                        {renderWearName(wear)}
                      </td>
                      <td className="py-3 text-right text-emerald-600 dark:text-emerald-400 font-mono font-semibold">
                        {formatPrice(avgPrices[wear], rate, symbol)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* Renderização Dinâmica das Tabelas (Normal, ST, Souvenir) */}
        {tableCategories.map((category, index) => (
          <div key={`table-cat-${index}`} className="mb-10 last:mb-0">

            <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-x-auto shadow-2xl transition-colors">
              <table className="w-full text-left border-collapse min-w-max">
                <thead>
                  <tr className="bg-neutral-100 dark:bg-neutral-950 border-b border-neutral-300 dark:border-neutral-800 transition-colors">
                    <th className="p-5 font-bold text-neutral-700 dark:text-neutral-300 border-r border-neutral-300 dark:border-neutral-800 sticky left-0 bg-neutral-100 dark:bg-neutral-950 z-10 w-48 shadow-[2px_0_5px_rgba(0,0,0,0.1)] dark:shadow-[2px_0_5px_rgba(0,0,0,0.5)]">
                      Wear
                    </th>
                    {/* Renderização Dinâmica do Tooltip Aqui */}
                    {sortedMarkets.map(market => (
                      <th key={market} className="p-4 text-center">
                        <MarketTooltip marketName={market}>
                          {marketsInfo[market] ? (
                            <img
                              src={marketsInfo[market]}
                              alt={market}
                              className="h-8 w-auto mx-auto object-contain transition-all drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
                            />
                          ) : (
                            <span className="font-bold text-neutral-700 dark:text-neutral-300 uppercase tracking-wider text-xs">
                              {market}
                            </span>
                          )}
                        </MarketTooltip>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/50 transition-colors">
                  {category.wears.map((wear) => (
                    <tr key={wear} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/30 transition-colors group">
                      <td className="p-5 font-medium border-r border-neutral-300 dark:border-neutral-800 sticky left-0 bg-white dark:bg-neutral-900 group-hover:bg-neutral-50 dark:group-hover:bg-neutral-800/80 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.1)] dark:shadow-[2px_0_5px_rgba(0,0,0,0.5)] transition-colors">
                        {renderWearName(wear)}
                      </td>

                      {sortedMarkets.map(market => {
                        const price = priceMap[wear]?.[market];
                        const isSteam = market === steamName;
                        const isCheapest = !isSteam && price === minPrices[wear];

                        return (
                          <td key={market} className="p-4 text-center bg-neutral-50/50 dark:bg-neutral-900/50">
                            {price ? (
                              <div className={`inline-block px-4 py-1.5 border font-mono font-semibold text-sm tracking-tight rounded-full transition-all
                                ${isSteam ? 'bg-slate-200 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700' : 
                                  isCheapest ? 'bg-emerald-500 text-neutral-50 dark:text-neutral-950 border-emerald-500 dark:border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)] dark:shadow-[0_0_15px_rgba(16,185,129,0.2)]' : 
                                  'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/5 dark:text-emerald-400 dark:border-emerald-500/20'}
                              `}>
                                {formatPrice(price, rate, symbol)}
                              </div>
                            ) : (
                              <span className="text-neutral-400 dark:text-neutral-700 font-mono text-sm block">-</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {/* --- GRÁFICO DE HISTÓRICO DE PREÇOS --- */}
        {chartData.length > 0 && (
          <PriceHistoryChart data={chartData} rate={rate} symbol={symbol} />
        )}
        <div className="mb-10"></div> {/* Espaçamento extra antes das tabelas */}

      </div>
    </main>
  );
}