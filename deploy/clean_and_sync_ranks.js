/**
 * clean_and_sync_ranks.js
 * 清理并规范化职称字典表 (brace_rank)：
 * 按照顺序只保留：
 *   1: 正高 (权重 3, 启用 1)
 *   2: 高级 (权重 2, 启用 1)
 *   3: 中级 (权重 1, 启用 1)
 * 同时同步：
 *   1. expert_info_major 关联专家的职称与编码 (30位组长->正高, 47位组员->高级, 23位组员->中级)
 *   2. brace_major_rank 专业与职称绑定关联
 */

const mysql = require('mysql2/promise');

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'codepush0',
  database: process.env.DB_NAME || 'geology_expert_db'
};

async function main() {
  console.log(`Connecting to ${config.host}:${config.port}/${config.database}...`);
  const conn = await mysql.createConnection(config);

  console.log('\n--- 清理前 brace_rank 数据 ---');
  const [oldRanks] = await conn.query('SELECT id, rank_name, rank_weight, rank_status FROM brace_rank ORDER BY id ASC');
  console.table(oldRanks);

  console.log('\n--- 1. 清空 brace_rank 并写入目标职称（正高、高级、中级）---');
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  await conn.query('TRUNCATE TABLE brace_rank');

  await conn.query(`
    INSERT INTO brace_rank (id, rank_name, rank_weight, rank_status, insert_time) VALUES
    (1, '正高', 3, 1, NOW()),
    (2, '高级', 2, 1, NOW()),
    (3, '中级', 1, 1, NOW())
  `);

  console.log('\n--- 2. 更新 expert_info_major 职称映射 ---');
  const [res1] = await conn.query(`
    UPDATE expert_info_major 
    SET rank_code = 1, rank_name = '正高' 
    WHERE rank_name LIKE '%正高%' OR rank_code = 1 OR rank_code = 1686268859800408000
  `);
  console.log(`  ✓ 正高更新: ${res1.affectedRows} 条`);

  const [res2] = await conn.query(`
    UPDATE expert_info_major 
    SET rank_code = 2, rank_name = '高级' 
    WHERE (rank_name LIKE '%高级%' AND rank_name NOT LIKE '%正高%') OR rank_code = 2 OR rank_code = 1686268823129608200
  `);
  console.log(`  ✓ 高级更新: ${res2.affectedRows} 条`);

  const [res3] = await conn.query(`
    UPDATE expert_info_major 
    SET rank_code = 3, rank_name = '中级' 
    WHERE (rank_name LIKE '%工程师%' AND rank_name NOT LIKE '%高级%') OR rank_name LIKE '%中级%' OR rank_code = 3 OR rank_code = 1686268760089219000
  `);
  console.log(`  ✓ 中级更新: ${res3.affectedRows} 条`);

  console.log('\n--- 3. 重新同步 brace_major_rank 关联关系 ---');
  await conn.query('TRUNCATE TABLE brace_major_rank');
  const [bmrRes] = await conn.query(`
    INSERT INTO brace_major_rank (brace_major_id, brace_rank_id, insert_time)
    SELECT id, 1, NOW() FROM brace_major
    UNION ALL
    SELECT id, 2, NOW() FROM brace_major
    UNION ALL
    SELECT id, 3, NOW() FROM brace_major
  `);
  console.log(`  ✓ 已为全部专业绑定 3 级标准职称，生成关联: ${bmrRes.affectedRows} 条`);

  await conn.query('SET FOREIGN_KEY_CHECKS = 1');

  console.log('\n--- 清理后 brace_rank 数据 ---');
  const [newRanks] = await conn.query('SELECT id, rank_name, rank_weight, rank_status FROM brace_rank ORDER BY id ASC');
  console.table(newRanks);

  console.log('\n--- 清理后 expert_info_major 职称统计 ---');
  const [majorStats] = await conn.query('SELECT rank_code, rank_name, count(*) as cnt FROM expert_info_major GROUP BY rank_code, rank_name ORDER BY rank_code ASC');
  console.table(majorStats);

  await conn.end();
  console.log('\n职称数据清理与同步完成！');
}

main().catch(err => {
  console.error('执行失败:', err);
  process.exit(1);
});
