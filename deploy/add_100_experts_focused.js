/**
 * add_100_experts_focused.js
 * 增量添加 100 位专家（使总数达到 200 位）：
 * 重点加在【前三专业】与【前三地区】：
 * 前三专业：
 *   1. 地质矿产（煤炭） (32位，含 10 组长 + 22 组员)
 *   2. 地质矿产（煤层气） (32位，含 10 组长 + 22 组员)
 *   3. 地质矿产（金属） (32位，含 10 组长 + 22 组员)
 *   4. 水工环地质 (4位，含 1 组长 + 3 组员)
 * 前三地区：
 *   1. 呼和浩特市 (40位)
 *   2. 包头市 (35位)
 *   3. 乌海市 (25位)
 * 职称严格只使用标准：
 *   - 正高 (组长, rank_code = 1)
 *   - 高级 (组员, rank_code = 2)
 *   - 中级 (组员, rank_code = 3)
 * 全部 assess_score = 100, audit_state = 1, if_lock = 0
 */

const mysql = require('mysql2/promise');

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'codepush0',
  database: process.env.DB_NAME || 'geology_expert_db'
};

// 目标专业（前三为主）
const TARGET_MAJORS = [
  { name: '地质矿产（煤炭）', code: 'A01', path: 'A-A01', targetCount: 32, leaderCount: 10 },
  { name: '地质矿产（煤层气）', code: 'A02', path: 'A-A02', targetCount: 32, leaderCount: 10 },
  { name: '地质矿产（金属）', code: 'A03', path: 'A-A03', targetCount: 32, leaderCount: 10 },
  { name: '水工环', code: 'A10', path: 'A-A10', targetCount: 4, leaderCount: 1 }
];

// 前三地区定义
const TARGET_REGIONS = [
  { name: '呼和浩特市', code: 'A01', path: 'A-A01', distCode: '150100', quota: 40 },
  { name: '包头市', code: 'A02', path: 'A-A02', distCode: '150200', quota: 35 },
  { name: '乌海市', code: 'A03', path: 'A-A03', distCode: '150300', quota: 25 }
];

// 常见单位
const UNITS = [
  { name: '内蒙古自治区地质调查研究院', code: 'NMDDY001' },
  { name: '内蒙古煤田地质局109队', code: 'NMMT109' },
  { name: '内蒙古煤田地质局117队', code: 'NMMT117' },
  { name: '内蒙古自治区矿产资源储量评审中心', code: 'NMCLPS001' },
  { name: '包头有色地质勘查开发院', code: 'BTYSE001' },
  { name: '内蒙古包钢矿业勘察技术有限公司', code: 'BGMY002' },
  { name: '内蒙古第三地质矿产勘查开发有限责任公司', code: 'NMDK003' },
  { name: '乌海市矿业能源工程技术中心', code: 'WHMY001' },
  { name: '内蒙古矿业集团有限责任公司', code: 'NMMG001' },
  { name: '中国地质科学院矿产资源研究所', code: 'CAGS001' }
];

const SURNAMES = [
  '赵', '钱', '孙', '李', '周', '吴', '郑', '王', '冯', '陈', '褚', '卫', '蒋', '沈', '韩', '杨',
  '朱', '秦', '尤', '许', '何', '吕', '施', '张', '孔', '曹', '严', '华', '金', '魏', '陶', '姜'
];
const GIVEN_NAMES = [
  '大为', '景天', '志坚', '正邦', '少华', '子敬', '宏毅', '振邦', '承泽', '永昌',
  '思淼', '博裕', '天宇', '兴修', '泰河', '文瑞', '飞舟', '浩博', '光亮', '建明',
  '晓晴', '文静', '秀华', '思雅', '慧敏', '若兰', '海霞', '春梅', '玉洁', '淑芬'
];

async function main() {
  console.log(`Connecting to ${config.host}:${config.port}/${config.database}...`);
  const conn = await mysql.createConnection(config);

  const [countBefore] = await conn.query('SELECT COUNT(*) as cnt FROM expert_info_base');
  console.log(`当前专家数量: ${countBefore[0].cnt} 位`);

  // 展开 100 个专业席位配置
  const expertTasks = [];
  for (const m of TARGET_MAJORS) {
    for (let i = 0; i < m.targetCount; i++) {
      const isLeader = i < m.leaderCount;
      expertTasks.push({
        major: m,
        isLeader
      });
    }
  }

  // 展开 100 个地区席位配置
  const regionPool = [];
  for (const r of TARGET_REGIONS) {
    for (let i = 0; i < r.quota; i++) {
      regionPool.push(r);
    }
  }

  // 打乱地区席位，使各专业均匀分布在呼市、包头、乌海
  for (let i = regionPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [regionPool[i], regionPool[j]] = [regionPool[j], regionPool[i]];
  }

  const BASE_ID = 1800000000000100n; // 101 ~ 200
  let createdCount = 0;

  for (let idx = 0; idx < expertTasks.length; idx++) {
    const task = expertTasks[idx];
    const region = regionPool[idx];
    const currentId = (BASE_ID + BigInt(idx + 1)).toString();

    // 姓名
    const surname = SURNAMES[(idx * 7) % SURNAMES.length];
    const givenName = GIVEN_NAMES[(idx * 11) % GIVEN_NAMES.length];
    const expertName = surname + givenName;

    // 性别
    const sex = idx % 5 === 0 ? 2 : 1;

    // 手机号 (唯一 139 段)
    const phone = '139' + String(10000101 + idx).padStart(8, '0');

    // 身份证 (合规 18 位)
    const birthYear = 1968 + (idx % 28); // 30~58岁
    const birthMonth = String((idx % 12) + 1).padStart(2, '0');
    const birthDay = String((idx % 28) + 1).padStart(2, '0');
    const seq = String(100 + (idx % 800) + (sex === 1 ? 1 : 0)).padStart(3, '0');
    const idCard = `${region.distCode}${birthYear}${birthMonth}${birthDay}${seq}X`;

    // 单位
    const unit = UNITS[idx % UNITS.length];

    // 职称 (正高: 1, 高级: 2, 中级: 3)
    let rankCode = 3;
    let rankName = '中级';
    if (task.isLeader) {
      rankCode = 1;
      rankName = '正高';
    } else if (idx % 3 !== 0) {
      rankCode = 2;
      rankName = '高级';
    }

    const leaderVal = task.isLeader ? 1 : 2;
    const degreeId = (idx % 4 === 0) ? '16' : ((idx % 3 === 0) ? '15' : '14');
    const degreeName = degreeId === '16' ? '博士' : (degreeId === '15' ? '硕士' : '本科');

    // 1. 插入 expert_info_base
    await conn.query(
      `INSERT INTO expert_info_base (
        id, ei_name, sex, phone, id_number,
        ent_name, ent_code, area_code, area_text,
        study_major_id, study_major_name, degree_id, degree_name,
        leader, if_retire, if_stop, if_leave, if_black, if_lock,
        audit_state, assess_score, assess_level,
        insert_time, last_update_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        currentId, expertName, sex, phone, idCard,
        unit.name, unit.code, region.code, region.name,
        '21', '地质资源与地质工程', degreeId, degreeName,
        leaderVal, 0, 0, 0, 0, 0,
        1, 100, '甲'
      ]
    );

    // 2. 插入 expert_info_major
    const majorRecordId = (BigInt(currentId) + 1000000n).toString();
    await conn.query(
      `INSERT INTO expert_info_major (
        id, ei_id, major_code, major_name, rank_code, rank_name, insert_time
      ) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        majorRecordId, currentId, task.major.path, task.major.name, rankCode, rankName
      ]
    );

    createdCount++;
  }

  console.log(`\n✓ 成功增量创建 ${createdCount} 位专家！`);

  // 统计结果验证
  const [totalExperts] = await conn.query('SELECT COUNT(*) as cnt FROM expert_info_base');
  console.log(`\n--- 插入后专家总库: ${totalExperts[0].cnt} 位 ---`);

  console.log('\n--- 盟市分布统计 ---');
  const [areaStats] = await conn.query('SELECT area_text, count(*) as cnt, sum(case when leader = 1 then 1 else 0 end) as leaders FROM expert_info_base GROUP BY area_text ORDER BY cnt DESC');
  console.table(areaStats);

  console.log('\n--- 专业分布统计 ---');
  const [majorStats] = await conn.query('SELECT major_name, count(*) as cnt, sum(case when rank_code = 1 then 1 else 0 end) as leaders FROM expert_info_major GROUP BY major_name ORDER BY cnt DESC');
  console.table(majorStats);

  console.log('\n--- 职称分布统计 ---');
  const [rankStats] = await conn.query('SELECT rank_code, rank_name, count(*) as cnt FROM expert_info_major GROUP BY rank_code, rank_name ORDER BY rank_code ASC');
  console.table(rankStats);

  await conn.end();
  console.log('\n增量添加完成！');
}

main().catch(err => {
  console.error('增量添加失败:', err);
  process.exit(1);
});
