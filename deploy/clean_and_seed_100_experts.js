const mysql = require('mysql2/promise');

// 盟市定义 (内蒙古 12 个盟市全覆盖，总配额 100 人，组长配额 30 人)
const AREAS = [
  { name: '呼和浩特市', code: 'A01', path: 'A-A01', idPrefix: '150102', phonePrefix: '1384710', quota: 16, leaderQuota: 5, units: ['内蒙古地质矿产勘查有限责任公司', '内蒙古自治区地质调查研究院', '内蒙古矿业（集团）有限责任公司', '呼和浩特市自然资源勘查规划院'] },
  { name: '包头市', code: 'A02', path: 'A-A02', idPrefix: '150203', phonePrefix: '1384720', quota: 12, leaderQuota: 4, units: ['包头市矿产资源开发中心', '内蒙古包钢矿业有限责任公司', '内蒙古自治区地质勘查二院'] },
  { name: '鄂尔多斯市', code: 'A06', path: 'A-A06', idPrefix: '150602', phonePrefix: '1384770', quota: 14, leaderQuota: 4, units: ['鄂尔多斯市煤炭地质勘查开发院', '内蒙古伊泰集团煤矿地质研究所', '准格尔旗矿产资源保护中心'] },
  { name: '赤峰市', code: 'A04', path: 'A-A04', idPrefix: '150402', phonePrefix: '1384760', quota: 10, leaderQuota: 3, units: ['内蒙古自治区地质矿产勘查开发局赤峰勘查院', '赤峰中色矿业勘查技术有限公司'] },
  { name: '通辽市', code: 'A05', path: 'A-A05', idPrefix: '150502', phonePrefix: '1384750', quota: 8, leaderQuota: 3, units: ['通辽市地质环境监测站', '内蒙古霍林河煤业集团地勘公司'] },
  { name: '呼伦贝尔市', code: 'A07', path: 'A-A07', idPrefix: '150702', phonePrefix: '1384700', quota: 8, leaderQuota: 2, units: ['呼伦贝尔有色金属地质勘探院', '满洲里矿产勘察中心'] },
  { name: '乌海市', code: 'A03', path: 'A-A03', idPrefix: '150302', phonePrefix: '1384730', quota: 6, leaderQuota: 2, units: ['乌海市煤炭地质工程勘测设计院', '乌海市矿业安全监测站'] },
  { name: '巴彦淖尔市', code: 'A08', path: 'A-A08', idPrefix: '150802', phonePrefix: '1384780', quota: 6, leaderQuota: 2, units: ['巴彦淖尔市地质勘查服务中心', '乌拉特后旗矿产开发管理局'] },
  { name: '乌兰察布市', code: 'A09', path: 'A-A09', idPrefix: '150902', phonePrefix: '1384740', quota: 6, leaderQuota: 2, units: ['乌兰察布市非金属矿产地质勘查所', '四子王旗地矿发展中心'] },
  { name: '锡林郭勒盟', code: 'A11', path: 'A-A11', idPrefix: '152502', phonePrefix: '1384790', quota: 6, leaderQuota: 1, units: ['锡林郭勒盟白音华煤电地勘处', '锡林浩特矿产资源管理站'] },
  { name: '兴安盟', code: 'A10', path: 'A-A10', idPrefix: '152201', phonePrefix: '1384820', quota: 4, leaderQuota: 1, units: ['兴安盟水工环地质调查所', '阿尔山市自然资源评估中心'] },
  { name: '阿拉善盟', code: 'A12', path: 'A-A12', idPrefix: '152921', phonePrefix: '1384830', quota: 4, leaderQuota: 1, units: ['阿拉善盟盐矿地质勘察院', '阿拉善左旗黄金地质普查队'] }
];

// 核心专业定义 (15 个核心专业全覆盖)
const MAJORS = [
  { name: '地质矿产（煤炭）', code: 'A01', path: 'A-A01' },
  { name: '地质矿产（金属）', code: 'A03', path: 'A-A03' },
  { name: '地质矿产（非金属）', code: 'A04', path: 'A-A04' },
  { name: '地质矿产（煤层气）', code: 'A02', path: 'A-A02' },
  { name: '地质矿产（煤炭资源储量核算）', code: 'A05', path: 'A-A05' },
  { name: '水工环', code: 'A14', path: 'A-A14' },
  { name: '物探（煤炭）', code: 'A10', path: 'A-A10' },
  { name: '物探（金属）', code: 'A11', path: 'A-A11' },
  { name: '化探', code: 'A13', path: 'A-A13' },
  { name: '测量', code: 'A09', path: 'A-A09' },
  { name: '采矿（煤炭-井工）', code: 'A15', path: 'A-A15' },
  { name: '采矿（煤炭-露天）', code: 'A16', path: 'A-A16' },
  { name: '采矿（金属）', code: 'A17', path: 'A-A17' },
  { name: '选冶', code: 'A19', path: 'A-A19' },
  { name: '矿产经济', code: 'A21', path: 'A-A21' }
];

// 职称定义
const RANKS = [
  { rank_name: '正高级工程师', rank_code: 1686268859800408000 },
  { rank_name: '高级工程师', rank_code: 1686268823129608200 },
  { rank_name: '工程师', rank_code: 1686268760089219000 }
];

// 常见百家姓与名
const SURNAMES = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗', '梁', '宋', '郑', '谢', '韩', '唐', '冯', '于', '董', '程'];
const GIVEN_NAMES = ['建国', '德强', '世杰', '文华', '海峰', '宏伟', '国栋', '永安', '志鹏', '振华', '光辉', '祥林', '春明', '建民', '晓东', '俊杰', '向东', '卫国', '明清', '晓林', '立新', '少峰', '成龙', '云龙', '青云', '国昌', '浩宇', '广福', '志平', '维新', '秀兰', '玉珍', '海燕', '美琴', '桂芝', '文慧', '思颖', '丽娜', '秋霞', '冬梅'];

async function runCleanAndSeed(config) {
  const conn = await mysql.createConnection(config);
  console.log(`\n======================================================`);
  console.log(`🚀 开始在 [${config.host}:${config.port}] 数据库中清洗并初始化 100 位专家...`);

  // 1. 先删旧专家数据与旧抽取结果
  console.log('1. 清理旧测试数据...');
  await conn.query('DELETE FROM extract_rule_result');
  await conn.query('DELETE FROM expert_info_major');
  await conn.query('DELETE FROM expert_info_base');
  console.log('✅ 旧数据清理完毕！');

  // 2. 构造 100 位真实专家
  console.log('2. 构造 100 位多样化地区与专业的真实专家...');
  let totalCreated = 0;
  let leaderCount = 0;
  let memberCount = 0;

  let baseIdSeed = 1800000000000000;
  let leaderMajorIdx = 0;
  let memberMajorIdx = 0;

  for (const area of AREAS) {
    let areaLeaderAssigned = 0;

    for (let i = 1; i <= area.quota; i++) {
      totalCreated++;
      const currentId = baseIdSeed + totalCreated;
      
      // 姓名
      const sur = SURNAMES[(totalCreated * 7) % SURNAMES.length];
      const giv = GIVEN_NAMES[(totalCreated * 11) % GIVEN_NAMES.length];
      const eiName = sur + giv;

      // 性别 (约 80% 男, 20% 女)
      const sex = (totalCreated % 5 === 0) ? 2 : 1;

      // 手机号 (唯一真实号段)
      const phoneSuffix = String(totalCreated).padStart(4, '0');
      const phone = `${area.phonePrefix}${phoneSuffix}`;

      // 身份证号
      const birthYear = 1970 + (totalCreated % 18); // 1970 ~ 1987 (37~54岁)
      const birthMonth = String(1 + (totalCreated % 12)).padStart(2, '0');
      const birthDay = String(1 + (totalCreated % 28)).padStart(2, '0');
      const idSeq = String(100 + (totalCreated % 800) + sex);
      const idNumber = `${area.idPrefix}${birthYear}${birthMonth}${birthDay}${idSeq}`;

      // 所属单位与代码
      const entName = area.units[(totalCreated) % area.units.length];
      const entCode = `91150000MA0N${String(10000 + totalCreated).slice(1)}X`;

      // 组长设定：严格按照盟市组长配额分配，且组长专业在 15 个核心专业中循环（每个专业 2 位组长）
      let isLeader = false;
      let majorObj = null;

      if (areaLeaderAssigned < area.leaderQuota) {
        isLeader = true;
        areaLeaderAssigned++;
        leaderCount++;
        majorObj = MAJORS[leaderMajorIdx % MAJORS.length];
        leaderMajorIdx++;
      } else {
        isLeader = false;
        memberCount++;
        majorObj = MAJORS[memberMajorIdx % MAJORS.length];
        memberMajorIdx++;
      }

      const leaderVal = isLeader ? 1 : 2;

      // 职称: 组长全部为正高级工程师, 组员分布为高级工程师与工程师
      const rankObj = isLeader ? RANKS[0] : (totalCreated % 3 === 0 ? RANKS[2] : RANKS[1]);

      // 学历与所学专业
      const degreeId = (totalCreated % 4 === 0) ? '16' : (totalCreated % 3 === 0 ? '15' : '14'); // 博士/硕士/本科
      const studyMajorId = '21'; // 矿山工程/地质

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
          currentId, eiName, sex, phone, phone, idNumber, entName, entCode,
          area.path, `内蒙古自治区-${area.name}`, degreeId, studyMajorId, majorObj.name,
          leaderVal
        ]
      );

      // 插入 expert_info_major (保证与主表 ID 对应关联)
      const majorRecordId = currentId + 1000000;
      await conn.query(
        `INSERT INTO expert_info_major (
          id, ei_id, major_code, major_name, rank_code, rank_name, insert_time
        ) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          majorRecordId, currentId, majorObj.path, majorObj.name, rankObj.rank_code, rankObj.rank_name
        ]
      );
    }
  }

  console.log(`✅ 成功创建 ${totalCreated} 位真实专家数据！其中组长 ${leaderCount} 位，组员 ${memberCount} 位。`);

  // 3. 统计分布验证
  console.log('\n3. 统计验证报告：');
  const [areaStats] = await conn.query(`
    SELECT e.area_text, count(*) as count, sum(case when e.leader = 1 then 1 else 0 end) as leaders
    FROM expert_info_base e
    GROUP BY e.area_text
    ORDER BY count DESC
  `);
  console.log('--- 地区分布 (12 盟市全部拥有专家与组长) ---');
  console.table(areaStats);

  const [majorStats] = await conn.query(`
    SELECT m.major_name, count(*) as count, sum(case when e.leader = 1 then 1 else 0 end) as leaders
    FROM expert_info_base e
    JOIN expert_info_major m ON e.id = m.ei_id
    GROUP BY m.major_name
    ORDER BY count DESC
  `);
  console.log('--- 专业分布 (15 核心专业全部拥有 2 位组长与 4~5 位组员) ---');
  console.table(majorStats);

  await conn.end();
}

module.exports = { runCleanAndSeed };

if (require.main === module) {
  const target = process.argv[2] || 'local';
  if (target === 'local') {
    runCleanAndSeed({
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: 'codepush0',
      database: 'geology_expert_db'
    }).catch(console.error);
  }
}
