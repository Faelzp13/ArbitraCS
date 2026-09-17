import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query || query.length < 2) {
    return NextResponse.json([]);
  }

  try {
    const pool = await getConnection();

    // Troca espaços por '%' para achar "Shadow Daggers" mesmo se for "Shadow-Daggers"
    const dbTerm = '%' + query.trim().replace(/\s+/g, '%') + '%';

    const result = await pool.query(`
      SELECT tradeup_id, skin_name, image_url 
      FROM dim_skins 
      WHERE skin_name ILIKE $1 
      LIMIT 50
    `, [dbTerm]);

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error("Erro na busca:", error);
    return NextResponse.json({ error: 'Erro ao buscar skins' }, { status: 500 });
  }
}