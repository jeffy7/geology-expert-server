/**
 * clean_projects_and_alters.js
 * 清理本地及云端数据库中的：
 * 1. 项目数据 (project, biz_project, project_operator, biz_project_avoid_expert, biz_project_extract_rule, avoidance_project)
 * 2. 专家抽取及补抽规则与结果数据 (extract_rule, extract_rule_condition, extract_rule_snapshot, extract_rule_apply_snapshot, extract_rule_condition_snapshot, extract_rule_result, notice_expert_callback, statistic_*)
 * 3. 专家信息变更表 (expert_info_alter)
 * 4. 相关的审批流记录 (audit_record)
 * 5. 确保 expert_info_base 中专家锁定标记 if_lock 全部重置为 0
 */

const mysql = require('mysql2/promise');

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'codepush0',
  database: process.env.DB_NAME || 'geology_expert_db'
};

const tablesToClean = [
  'project',
  'project_operator',
  'biz_project',
  'biz_project_avoid_expert',
  'biz_project_extract_rule',
  'avoidance_project',
  'extract_rule',
  'extract_rule_condition',
  'extract_rule_snapshot',
  'extract_rule_apply_snapshot',
  'extract_rule_condition_snapshot',
  'extract_rule_result',
  'statistic_extract_rule_condition_avoidance_company',
  'statistic_extract_rule_condition_major',
  'notice_expert_callback',
  'expert_info_alter',
  'audit_record'
];

async function main() {
  console.log(`Connecting to ${config.host}:${config.port}/${config.database}...`);
  const conn = await mysql.createConnection(config);

  console.log('\n--- 清理前数据统计 ---');
  for (const table of tablesToClean) {
    try {
      const [rows] = await conn.query(`SELECT COUNT(*) as cnt FROM ${table}`);
      console.log(`  ${table}: ${rows[0].cnt} 条`);
    } catch (err) {
      console.log(`  ${table}: 表不存在或查询失败 (${err.message})`);
    }
  }

  console.log('\n--- 正在执行数据清理 ---');
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');

  for (const table of tablesToClean) {
    try {
      await conn.query(`TRUNCATE TABLE ${table}`);
      console.log(`  ✓ 已清空表: ${table}`);
    } catch (err) {
      try {
        await conn.query(`DELETE FROM ${table}`);
        console.log(`  ✓ 已通过 DELETE 清空表: ${table}`);
      } catch (e) {
        console.warn(`  ! 清理表 ${table} 失败: ${e.message}`);
      }
    }
  }

  // 重置专家锁定标记
  await conn.query('UPDATE expert_info_base SET if_lock = 0');
  console.log('  ✓ 已将 expert_info_base 所有专家的 if_lock 重置为 0 (解锁)');

  await conn.query('SET FOREIGN_KEY_CHECKS = 1');

  console.log('\n--- 清理后数据统计 ---');
  for (const table of tablesToClean) {
    try {
      const [rows] = await conn.query(`SELECT COUNT(*) as cnt FROM ${table}`);
      console.log(`  ${table}: ${rows[0].cnt} 条`);
    } catch (err) {
      console.log(`  ${table}: (${err.message})`);
    }
  }

  const [expertCount] = await conn.query('SELECT COUNT(*) as cnt FROM expert_info_base');
  console.log(`\n  当前专家库基准数量保持不变: ${expertCount[0].cnt} 位`);

  await conn.end();
  console.log('\n清理完成！');
}

main().catch(err => {
  console.error('执行清理失败:', err);
  process.exit(1);
});
