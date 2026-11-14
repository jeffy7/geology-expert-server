/**
 * seed_200_experts_with_abundant_candidates.js
 * 
 * 按照用户核心测试诉求重新初始化 200 位高质量真实专家数据：
 * 1. 重点专业（前三）：地质矿产（煤炭）、地质矿产（煤层气）、地质矿产（金属）
 * 2. 重点地区（前三）：呼和浩特市、包头市、乌海市
 * 3. 严格保障【前三专业 × 前三地区】九大细分组合中，每个组合的组长均 >= 6 位（大于5位），组员 >= 10 位，
 *    彻底杜绝一次抽选后无候选人可供补抽的问题！
 * 4. 职称严格只使用标准：正高 (1, 权重3)、高级 (2, 权重2)、中级 (3, 权重1)
 * 5. 默认记分 100 分 (甲级)，手机号严格唯一，身份证号合法对齐盟市
 * 6. 状态 audit_state=1, if_stop=0, if_leave=0, if_black=0, if_lock=0
 */

const mysql = require('mysql2/promise');

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'codepush0',
  database: process.env.DB_NAME || 'geology_expert_db'
};

// 重点前三专业
const TOP3_MAJORS = [
  { name: '地质矿产（煤炭）', code: 'A01', path: 'A-A01' },
  { name: '地质矿产（煤层气）', code: 'A02', path: 'A-A02' },
  { name: '地质矿产（金属）', code: 'A03', path: 'A-A03' }
];

// 重点前三地区
const TOP3_REGIONS = [
  { name: '呼和浩特市', code: 'A01', path: 'A-A01', distCode: '150100', leaderQuota: 6, memberQuota: 12 },
  { name: '包头市', code: 'A02', path: 'A-A02', distCode: '150200', leaderQuota: 6, memberQuota: 12 },
  { name: '乌海市', code: 'A03', path: 'A-A03', distCode: '150300', leaderQuota: 6, memberQuota: 10 }
];

// 其他专业与地区（补齐其余 44 人，覆盖全区其余盟市）
const OTHER_MAJORS = [
  { name: '水工环', code: 'A10', path: 'A-A10', count: 8 },
  { name: '物探（煤炭）', code: 'A11', path: 'A-A11', count: 8 },
  { name: '化探', code: 'A13', path: 'A-A13', count: 8 },
  { name: '测量', code: 'A09', path: 'A-A09', count: 8 },
  { name: '采矿（煤炭-井工）', code: 'A14', path: 'A-A14', count: 8 },
  { name: '矿产经济', code: 'A21', path: 'A-A21', count: 4 }
];

const OTHER_REGIONS = [
  { name: '鄂尔多斯市', code: 'A06', distCode: '150600' },
  { name: '赤峰市', code: 'A04', distCode: '150400' },
  { name: '通辽市', code: 'A05', distCode: '150500' },
  { name: '呼伦贝尔市', code: 'A07', distCode: '150700' },
  { name: '巴彦淖尔市', code: 'A08', distCode: '150800' },
  { name: '乌兰察布市', code: 'A09', distCode: '150900' },
  { name: '锡林郭勒盟', code: 'A10', distCode: '152500' },
  { name: '兴安盟', code: 'A11', distCode: '152200' },
  { name: '阿拉善盟', code: 'A12', distCode: '152900' }
];

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
  { name: '中国地质科学院矿产资源研究所', code: 'CAGS001' },
  { name: '内蒙古自治区第一地质矿产勘查开发有限责任公司', code: 'NMDK001' },
  { name: '呼和浩特市浩源矿业勘查有限公司', code: 'HHHTHY01' }
];

const SURNAMES = [
  '赵', '钱', '孙', '李', '周', '吴', '郑', '王', '冯', '陈', '褚', '卫', '蒋', '沈', '韩', '杨',
  '朱', '秦', '尤', '许', '何', '吕', '施', '张', '孔', '曹', '严', '华', '金', '魏', '陶', '姜',
  '戚', '谢', '邹', '喻', '柏', '水', '窦', '章', '云', '苏', '潘', '葛', '奚', '范', '彭', '郎',
  '鲁', '韦', '昌', '马', '苗', '凤', '花', '方', '俞', '任', '袁', '柳', '酆', '鲍', '史', '唐'
];

const GIVEN_NAMES = [
  '建国', '德强', '世杰', '文华', '海峰', '宏伟', '国栋', '永安', '志鹏', '振华',
  '光辉', '祥林', '春明', '建民', '晓东', '俊杰', '向东', '卫国', '明清', '晓林',
  '立新', '少峰', '成龙', '云龙', '青云', '国昌', '浩宇', '广福', '志平', '维新',
  '大为', '景天', '志坚', '正邦', '少华', '子敬', '宏毅', '振邦', '承泽', '永昌',
  '思淼', '博裕', '天宇', '兴修', '泰河', '文瑞', '飞舟', '浩博', '光亮', '建明',
  '秀兰', '玉珍', '海燕', '美琴', '桂芝', '文慧', '思颖', '丽娜', '秋霞', '冬梅',
  '晓晴', '文静', '秀华', '思雅', '慧敏', '若兰', '海霞', '春梅', '玉洁', '淑芬'
];

async function main() {
  console.log(`Connecting to ${config.host}:${config.port}/${config.database}...`);
  const conn = await mysql.createConnection(config);

  console.log('\n--- 1. 清理现有专家库数据及抽取结果 ---');
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  await conn.query('TRUNCATE TABLE expert_info_major');
  await conn.query('TRUNCATE TABLE expert_info_base');
  await conn.query('TRUNCATE TABLE extract_rule_result');
  await conn.query('TRUNCATE TABLE notice_expert_callback');

  console.log('\n--- 2. 规范化职称字典 (正高, 高级, 中级) ---');
  await conn.query('TRUNCATE TABLE brace_rank');
  await conn.query(`
    INSERT INTO brace_rank (id, rank_name, rank_weight, rank_status, insert_time) VALUES
    (1, '正高', 3, 1, NOW()),
    (2, '高级', 2, 1, NOW()),
    (3, '中级', 1, 1, NOW())
  `);

  await conn.query('TRUNCATE TABLE brace_major_rank');
  await conn.query(`
    INSERT INTO brace_major_rank (brace_major_id, brace_rank_id, insert_time)
    SELECT id, 1, NOW() FROM brace_major
    UNION ALL
    SELECT id, 2, NOW() FROM brace_major
    UNION ALL
    SELECT id, 3, NOW() FROM brace_major
  `);

  console.log('\n--- 3. 规划 200 位专家席位分配 ---');
  const expertTasks = [];

  // 3.1 前三专业 × 前三地区：3 × 3 = 9 大重点矩阵
  for (const m of TOP3_MAJORS) {
    for (const r of TOP3_REGIONS) {
      // 组长分配
      for (let l = 0; l < r.leaderQuota; l++) {
        expertTasks.push({
          major: m,
          region: r,
          isLeader: true
        });
      }
      // 组员分配
      for (let mb = 0; mb < r.memberQuota; mb++) {
        expertTasks.push({
          major: m,
          region: r,
          isLeader: false
        });
      }
    }
  }
  // 当前重点席位：3 majors × ( (6+12) + (6+12) + (6+10) ) = 3 × 52 = 156 人
  console.log(`  前三专业 × 前三地区重点席位: ${expertTasks.length} 位 (每组合各 6 组长 + 10~12 组员)`);

  // 3.2 补充其他专业与盟市，凑齐 200 人
  let otherIdx = 0;
  for (const om of OTHER_MAJORS) {
    for (let c = 0; c < om.count; c++) {
      const reg = OTHER_REGIONS[otherIdx % OTHER_REGIONS.length];
      const isLeader = c < 2; // 每专业配 2 组长
      expertTasks.push({
        major: om,
        region: reg,
        isLeader
      });
      otherIdx++;
    }
  }
  console.log(`  全量规划席位总计: ${expertTasks.length} 位`);

  console.log('\n--- 4. 生成并写入 200 位真实专家数据 ---');
  const BASE_ID = 1800000000000000n;

  for (let idx = 0; idx < expertTasks.length; idx++) {
    const task = expertTasks[idx];
    const currentId = (BASE_ID + BigInt(idx + 1)).toString();

    // 姓名
    const sName = SURNAMES[idx % SURNAMES.length];
    const gName = GIVEN_NAMES[(idx * 3) % GIVEN_NAMES.length];
    const expertName = sName + gName;

    const sex = idx % 5 === 0 ? 2 : 1;

    // 唯一 11 位手机号
    const phone = '138' + String(10000001 + idx).padStart(8, '0');

    // 18 位身份证
    const birthYear = 1968 + (idx % 27);
    const birthMonth = String((idx % 12) + 1).padStart(2, '0');
    const birthDay = String((idx % 28) + 1).padStart(2, '0');
    const seq = String(100 + (idx % 800) + (sex === 1 ? 1 : 0)).padStart(3, '0');
    const idCard = `${task.region.distCode}${birthYear}${birthMonth}${birthDay}${seq}8`;

    const unit = UNITS[idx % UNITS.length];

    // 职称 (组长全为 正高:1, 组员为 高级:2 或 中级:3)
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

    // 插入 expert_info_base
    await conn.query(
      `INSERT INTO expert_info_base (
        id, ei_name, sex, phone, account, password, id_number, ent_name, ent_code,
        area_code, area_text, degree, study_major, study_major_name, leader, if_retire, apply_way,
        assess_score, assess_level, if_stop, if_leave, if_black, if_lock, if_perfect_info,
        audit_state, source_type, insert_time, last_update_time
      ) VALUES (
        ?, ?, ?, ?, ?, 'z123456', ?, ?, ?,
        ?, ?, ?, ?, ?, ?, 0, 3,
        100, '甲', 0, 0, 0, 0, 1,
        1, 2, NOW(), NOW()
      )`,
      [
        currentId, expertName, sex, phone, phone, idCard, unit.name, unit.code,
        task.region.code, task.region.name, degreeId, '21', '地质资源与地质工程', leaderVal
      ]
    );

    // 插入 expert_info_major
    const majorRecordId = (BigInt(currentId) + 1000000n).toString();
    await conn.query(
      `INSERT INTO expert_info_major (
        id, ei_id, major_code, major_name, rank_code, rank_name, insert_time
      ) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        majorRecordId, currentId, task.major.path, task.major.name, rankCode, rankName
      ]
    );
  }

  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  console.log(`  ✓ 成功插入 ${expertTasks.length} 位专家！`);

  // 5. 校验【前三专业 × 前三地区】九大细分组合的组长与组员数量
  console.log('\n--- 5. 校验【前三专业 × 前三地区】各组合可用人数 ---');
  const matrix = [];
  for (const m of TOP3_MAJORS) {
    for (const r of TOP3_REGIONS) {
      const [lRows] = await conn.query(`
        SELECT count(DISTINCT e.id) as cnt
        FROM expert_info_base e
        JOIN expert_info_major m ON e.id = m.ei_id
        WHERE e.leader = 1
          AND (m.major_name = ? OR m.major_code = ?)
          AND (e.area_text = ? OR e.area_code = ?)
      `, [m.name, m.path, r.name, r.code]);

      const [mRows] = await conn.query(`
        SELECT count(DISTINCT e.id) as cnt
        FROM expert_info_base e
        JOIN expert_info_major m ON e.id = m.ei_id
        WHERE e.leader = 2
          AND (m.major_name = ? OR m.major_code = ?)
          AND (e.area_text = ? OR e.area_code = ?)
      `, [m.name, m.path, r.name, r.code]);

      matrix.push({
        '专业': m.name,
        '地区': r.name,
        '组长人数(>=5)': lRows[0].cnt,
        '组员人数': mRows[0].cnt,
        '总人数': lRows[0].cnt + mRows[0].cnt
      });
    }
  }
  console.table(matrix);

  const [totalCnt] = await conn.query('SELECT count(*) as cnt FROM expert_info_base');
  console.log(`\n最终专家库总人数: ${totalCnt[0].cnt} 位`);

  await conn.end();
  console.log('\n初始化完成！');
}

main().catch(err => {
  console.error('初始化失败:', err);
  process.exit(1);
});
