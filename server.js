// 修改服务器代码，调整路由顺序

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const XLSX = require('xlsx');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
// Vercel 环境下不需要显式监听端口
const PORT = process.env.PORT || 3001;

// 配置文件上传
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 限制10MB
});

// 移除创建目录的代码，因为 Vercel 环境中不能写入文件系统
// if (!fs.existsSync('uploads')) {
//   fs.mkdirSync('uploads');
// }

// 添加路径日志中间件
app.use((req, res, next) => {
  console.log('请求路径:', req.method, req.path);
  next();
});

// 中间件
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(bodyParser.json());
app.use(express.static('public'));

// 添加 CSP 中间件
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' *.trycloudflare.com; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net *.trycloudflare.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data:; font-src 'self' https://cdn.jsdelivr.net; connect-src 'self' *.trycloudflare.com;"
  );
  next();
});

// 内存数据存储（生产环境应使用数据库）
const questions = {};

// 创建新问题
app.post('/api/questions', (req, res) => {
  const { questionText } = req.body;
  const questionId = uuidv4();
  
  questions[questionId] = {
    id: questionId,
    question: questionText,
    responses: [],
    createdAt: new Date()
  };
  
  // 使用请求头中的 host
  const host = req.headers.host;
  const protocol = req.protocol;
  const formUrl = `${protocol}://${host}/form.html?id=${questionId}`;
  
  res.json({ 
    success: true, 
    questionId,
    formUrl: formUrl
  });
});

// 获取问题信息
app.get('/api/questions/:id', (req, res) => {
  const { id } = req.params;
  
  if (!questions[id]) {
    return res.status(404).json({ success: false, message: '问题不存在' });
  }
  
  res.json({ 
    success: true, 
    question: questions[id]
  });
});

// 添加下载Excel接口
app.get('/api/questions/:id/download', (req, res) => {
  const { id } = req.params;
  
  if (!questions[id]) {
    return res.status(404).json({ success: false, message: '问题不存在' });
  }
  
  const responses = questions[id].responses;
  
  // 创建工作簿
  const wb = XLSX.utils.book_new();
  
  // 准备数据
  const data = [
    ['昵称', '回答', '提交时间'], // 表头
    ...responses.map(r => [
      r.nickname || '匿名', 
      r.answer, 
      new Date(r.submittedAt).toLocaleString()
    ])
  ];
  
  // 创建工作表
  const ws = XLSX.utils.aoa_to_sheet(data);
  
  // 将工作表添加到工作簿
  XLSX.utils.book_append_sheet(wb, ws, '回答数据');
  
  // 生成Excel文件
  const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  
  // 设置响应头
  res.setHeader('Content-Disposition', `attachment; filename="responses_${id}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  
  // 发送文件
  res.send(excelBuffer);
});

// 提交回答
app.post('/api/responses', (req, res) => {
  const { questionId, answer, nickname } = req.body;  // 添加nickname
  
  if (!questions[questionId]) {
    return res.status(404).json({ success: false, message: '问题不存在' });
  }
  
  // 添加回答
  questions[questionId].responses.push({
    answer,
    nickname,  // 保存昵称
    submittedAt: new Date()
  });
  
  res.json({ success: true });
});

// 添加分组设置路由
app.post('/api/questions/:id/settings', (req, res) => {
  const { id } = req.params;
  const { groupCount } = req.body;
  
  if (!questions[id]) {
    return res.status(404).json({ success: false, message: '问题不存在' });
  }
  
  // 验证分组数量在有效范围内
  const groupCountNum = parseInt(groupCount);
  if (isNaN(groupCountNum) || groupCountNum < 2 || groupCountNum > 100) {
    return res.status(400).json({ success: false, message: '分组数量必须在2-100之间' });
  }
  
  questions[id].groupCount = groupCountNum;
  res.json({ success: true });
});

// 添加分组分析路由
app.post('/api/questions/:id/analyze', async (req, res) => {
    const { id } = req.params;
    
    if (!questions[id]) {
        return res.status(404).json({ success: false, message: '问题不存在' });
    }
    
    const responses = questions[id].responses;
    const groupCount = questions[id].groupCount || 3;
    
    // 检查回答数量是否足够分组
    if (responses.length < groupCount) {
        return res.json({ 
            success: false, 
            message: `回答数量（${responses.length}个）不足以分成${groupCount}组，每组至少需要1人`
        });
    }
    
    try {
        const groups = await analyzeResponses(responses, groupCount);
        res.json({ 
            success: true, 
            groups: groups
        });
    } catch (error) {
        console.error('分析错误:', error);
        res.status(500).json({ 
            success: false, 
            message: '分析过程出错'
        });
    }
});

// 添加上传Excel接口
app.post('/api/questions/:id/upload', upload.single('file'), (req, res) => {
  console.log('收到文件上传请求:', req.params.id);
  console.log('请求头:', req.headers);
  
  const { id } = req.params;
  
  if (!questions[id]) {
    console.log('问题不存在:', id);
    return res.status(404).json({ success: false, message: '问题不存在' });
  }
  
  if (!req.file) {
    console.log('未收到文件');
    return res.status(400).json({ success: false, message: '未上传文件' });
  }

  console.log('文件信息:', req.file.originalname, req.file.size);

  try {
    // 从内存中读取 Excel 文件
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // 转换为JSON
    const data = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1,
      raw: false,
      defval: '' // 设置空单元格的默认值
    });
    
    console.log('Excel数据行数:', data.length);
    
    // 跳过表头，处理数据
    const newResponses = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row.length >= 2) {
        const nickname = row[0] || '匿名';
        const answer = row[1] || '';
        
        if (answer.trim()) {
          newResponses.push({
            nickname,
            answer,
            submittedAt: new Date()
          });
        }
      }
    }
    
    console.log('有效回答数:', newResponses.length);
    
    // 更新问题的回答
    questions[id].responses = newResponses;
    
    // 清除上传的临时文件
    // fs.unlink(req.file.path, (err) => {
    //   if (err) console.error('删除临时文件失败:', err);
    // });
    
    res.json({ 
      success: true, 
      count: newResponses.length,
      responses: newResponses
    });
  } catch (error) {
    console.error('处理Excel文件出错:', error);
    
    // 清除上传的临时文件
    // if (req.file && fs.existsSync(req.file.path)) {
    //   fs.unlink(req.file.path, (err) => {
    //     if (err) console.error('删除临时文件失败:', err);
    //   });
    // }
    
    res.status(500).json({ 
      success: false, 
      message: '处理Excel文件出错: ' + error.message 
    });
  }
});

// 使用简单的文本相似度计算
// 使用简单的文本相似度计算函数可以删除，因为我们不再使用它
// function calculateSimilarity(text1, text2) {
//   const set1 = new Set(text1.split(''));
//   const set2 = new Set(text2.split(''));
//   const intersection = new Set([...set1].filter(x => set2.has(x)));
//   return intersection.size / Math.sqrt(set1.size * set2.size);
// }

// 分析函数修改
async function analyzeResponses(responses, groupCount) {
    // 确保组数不超过回答数量
    if (responses.length < groupCount) {
        throw new Error(`回答数量（${responses.length}个）不足以分成${groupCount}组。每组至少需要1人，请减少组数或等待更多回答。`);
    }

    try {
        console.log('开始智能分组分析，回答数量:', responses.length);
        console.log('准备调用Kimi API进行智能分组...');
        
        // 修复：定义 allAnswers 变量
        const allAnswers = responses.map(r => r.answer);
        console.log('发送给AI的回答数据:', allAnswers);
        
        // 添加超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时
        
        try {
            const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer sk-gyU2frMJfrQsg83w97A335n2cpoJPqCSePPgDhoywKaDWiJd'
                },
                body: JSON.stringify({
                    model: "moonshot-v1-8k",
                    messages: [
                        {
                            role: "system",
                            content: "你是 Kimi，由 Moonshot AI 提供的人工智能助手。你现在需要分析一组文本回答，并将它们分组。请以JSON格式返回分组结果，格式为：{\"groups\":[{\"groupName\":\"组名1\",\"members\":[0,2,5]},{\"groupName\":\"组名2\",\"members\":[1,3,4]}]}"
                        },
                        {
                            role: "user",
                            content: `请将以下${responses.length}个回答分成${groupCount}组，每组至少包含1个回答。分组应基于回答内容的相似性或主题相关性：\n${allAnswers.map((answer, index) => `${index}. ${answer}`).join('\n')}`
                        }
                    ]
                }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            console.log('AI分组API响应状态:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('API错误详情:', errorText);
                throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('AI分组API响应数据:', JSON.stringify(data).substring(0, 200) + '...');
            
            if (data.error) {
                console.error('Kimi API 错误:', data.error);
                throw new Error('AI分组失败: ' + (data.error.message || JSON.stringify(data.error)));
            }
            
            // 解析AI返回的分组结果
            let aiGroups;
            try {
                // 尝试从AI回复中提取JSON
                const content = data.choices[0].message.content;
                console.log('AI返回的完整内容:', content); // 添加完整日志
                
                // 尝试使用更健壮的方式解析JSON
                let jsonStr = '';
                
                // 方法1: 尝试提取代码块中的JSON
                if (content.includes('```')) {
                    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                    if (jsonMatch && jsonMatch[1]) {
                        jsonStr = jsonMatch[1].trim();
                    }
                }
                
                // 方法2: 如果方法1失败，尝试直接查找JSON对象
                if (!jsonStr) {
                    const jsonObjMatch = content.match(/\{[\s\S]*\}/);
                    if (jsonObjMatch) {
                        jsonStr = jsonObjMatch[0];
                    } else {
                        jsonStr = content; // 使用完整内容作为后备
                    }
                }
                
                console.log('提取的JSON字符串:', jsonStr);
                
                // 尝试修复常见的JSON格式问题
                // 1. 替换中文引号为英文引号
                jsonStr = jsonStr.replace(/[""]/g, '"').replace(/['']/g, "'");
                
                // 2. 手动修复常见的JSON格式问题
                try {
                    // 尝试直接解析
                    aiGroups = JSON.parse(jsonStr);
                } catch (innerError) {
                    console.error('标准解析失败，尝试手动修复:', innerError);
                    
                    // 尝试修复缺少逗号的问题
                    const fixedJson = jsonStr.replace(/(\d+)\s+(\d+)/g, '$1, $2')
                                           .replace(/\]\s*\[/g, '], [')
                                           .replace(/\}\s*\{/g, '}, {');
                    
                    console.log('修复后的JSON:', fixedJson);
                    
                    try {
                        aiGroups = JSON.parse(fixedJson);
                    } catch (fixError) {
                        console.error('修复后解析仍然失败，尝试构建基本结构');
                        
                        // 如果仍然失败，尝试提取组名和成员信息
                        const groupNameMatches = content.match(/["']groupName["']\s*:\s*["']([^"']+)["']/g);
                        const memberMatches = content.match(/["']members["']\s*:\s*\[([\d\s,]+)\]/g);
                        
                        if (groupNameMatches && memberMatches && groupNameMatches.length === memberMatches.length) {
                            // 手动构建分组结果
                            aiGroups = { groups: [] };
                            
                            for (let i = 0; i < groupNameMatches.length; i++) {
                                const groupNameMatch = groupNameMatches[i].match(/["']groupName["']\s*:\s*["']([^"']+)["']/);
                                const memberMatch = memberMatches[i].match(/["']members["']\s*:\s*\[([\d\s,]+)\]/);
                                
                                if (groupNameMatch && memberMatch) {
                                    const groupName = groupNameMatch[1];
                                    const members = memberMatch[1].split(/\s*,\s*/)
                                                    .map(num => parseInt(num.trim()))
                                                    .filter(num => !isNaN(num));
                                    
                                    aiGroups.groups.push({
                                        groupName: groupName,
                                        members: members
                                    });
                                }
                            }
                        } else {
                            // 如果无法提取，创建默认分组
                            aiGroups = { 
                                groups: Array.from({ length: groupCount }, (_, i) => ({
                                    groupName: `默认组 ${i + 1}`,
                                    members: []
                                }))
                            };
                            
                            // 平均分配所有回答
                            for (let i = 0; i < responses.length; i++) {
                                const groupIndex = i % groupCount;
                                aiGroups.groups[groupIndex].members.push(i);
                            }
                        }
                    }
                }
                
                console.log('解析后的分组结果:', JSON.stringify(aiGroups, null, 2));
                
                // 验证结果格式
                if (!aiGroups || !aiGroups.groups) {
                    console.error('AI返回的数据格式不正确，创建默认格式');
                    aiGroups = { groups: [] };
                    
                    // 创建默认分组
                    for (let i = 0; i < groupCount; i++) {
                        aiGroups.groups.push({
                            groupName: `默认组 ${i + 1}`,
                            members: []
                        });
                    }
                    
                    // 平均分配所有回答
                    for (let i = 0; i < responses.length; i++) {
                        const groupIndex = i % groupCount;
                        aiGroups.groups[groupIndex].members.push(i);
                    }
                }
                
                // 确保groups是数组
                if (!Array.isArray(aiGroups.groups)) {
                    aiGroups.groups = [];
                }
            } catch (parseError) {
                console.error('解析AI分组结果失败:', parseError);
                console.error('解析失败的原始内容:', data.choices[0].message.content);
                
                // 创建默认分组结果
                aiGroups = { 
                    groups: Array.from({ length: groupCount }, (_, i) => ({
                        groupName: `默认组 ${i + 1}`,
                        members: []
                    }))
                };
                
                // 平均分配所有回答
                for (let i = 0; i < responses.length; i++) {
                    const groupIndex = i % groupCount;
                    aiGroups.groups[groupIndex].members.push(i);
                }
            }
            
            // 转换AI分组结果为我们需要的格式
            const groups = [];
            
            if (aiGroups && aiGroups.groups) {
                for (const group of aiGroups.groups) {
                    const members = [];
                    
                    // 添加组成员
                    if (Array.isArray(group.members)) {
                        for (const index of group.members) {
                            if (responses[index]) {
                                members.push({
                                    nickname: responses[index].nickname,
                                    answer: responses[index].answer
                                });
                            }
                        }
                    }
                    
                    groups.push({
                        name: group.groupName || await generateAIGroupName(members.map(m => m.answer).join('\n')),
                        members: members
                    });
                }
            }
            
            // 计算理想的每组人数
            const totalResponses = responses.length;
            const idealGroupSize = Math.ceil(totalResponses / groupCount);
            
            // 重新分配成员以平衡各组人数
            const allMembers = groups.reduce((acc, group) => [...acc, ...group.members], []);
            
            // 清空所有组的成员
            groups.forEach(group => {
                group.members = [];
            });
            
            // 重新分配成员，确保各组人数接近
            for (let i = 0; i < allMembers.length; i++) {
                const groupIndex = i % groupCount;
                groups[groupIndex].members.push(allMembers[i]);
            }
            
            // 如果组数不足，创建新组
            while (groups.length < groupCount) {
                groups.push({
                    name: `附加组 ${groups.length + 1}`,
                    members: []
                });
            }
            
            console.log('最终分组结果:', groups.map(g => ({name: g.name, count: g.members.length})));
            return groups;
            
        } catch (error) {
            clearTimeout(timeoutId);
            console.error('智能分组失败:', error);
            
            // 回退到随机分组
            console.log('使用随机分组作为备选方案');
            const groups = Array.from({ length: groupCount }, (_, i) => ({
                name: `随机组 ${i + 1}`,
                members: []
            }));

            // 随机分配回答到各组
            const shuffledResponses = [...responses].sort(() => Math.random() - 0.5);
            
            for (let i = 0; i < shuffledResponses.length; i++) {
                const groupIndex = i % groupCount;
                groups[groupIndex].members.push({
                    nickname: shuffledResponses[i].nickname,
                    answer: shuffledResponses[i].answer
                });
            }
            
            return groups;
        }
    } catch (error) {
        console.error('分析过程出错:', error);
        throw error;
    }
}

// 将 generateAIGroupName 函数移到 analyzeResponses 函数外部
async function generateAIGroupName(groupAnswers) {
  try {
    console.log('开始生成组名，完整回答内容:', groupAnswers);
    console.log('回答数量:', groupAnswers.split('\n').length);
    
    // 使用Kimi API生成组名
    console.log('准备调用Kimi API...');
    const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-gyU2frMJfrQsg83w97A335n2cpoJPqCSePPgDhoywKaDWiJd'
      },
      body: JSON.stringify({
        model: "moonshot-v1-8k",
        messages: [{
          role: 'system',
          content: '你是一个擅长分析文本并提取主题的助手。请分析这些回答，提取共同特点，并生成一个简短、有创意的组名。组名要求：1. 长度不超过10个字 2. 要体现这组回答的共同特点 3. 名字要非常有创意，不要简单地列出回答中的内容 4. 如果回答都是关于食物的，请生成一个有趣的美食主题组名'
        }, {
          role: 'user',
          content: `请分析这些回答并生成一个组名，不要简单重复回答内容：\n${groupAnswers}`
        }]
      })
    });
    
    console.log('API响应状态:', response.status);
    const data = await response.json();
    console.log('API响应数据:', JSON.stringify(data).substring(0, 200) + '...');
    
    if (data.error) {
      console.error('Kimi API 错误:', data.error);
      return '观点组';
    }
    
    const generatedName = data.choices && data.choices[0] && data.choices[0].message 
      ? data.choices[0].message.content.trim() 
      : '观点组';
    
    console.log('生成的组名:', generatedName);
    return generatedName;
  } catch (error) {
    console.error('生成组名时出错:', error);
    return '观点组';  // 发生错误时的默认组名
  }
}

// 获取问题的所有回答
app.get('/api/questions/:id/responses', (req, res) => {
  const { id } = req.params;
  
  if (!questions[id]) {
    return res.status(404).json({ success: false, message: '问题不存在' });
  }
  
  res.json({ 
    success: true, 
    responses: questions[id].responses
  });
});

// 添加测试路由
app.get('/test', (req, res) => {
  res.send('服务器正常运行');
});

// 在其他路由之前添加
app.get('/', (req, res) => {
  res.redirect('/index.html');
});

// 修改服务器启动方式，适应 Vercel 环境
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
  });
} else {
  console.log('在生产环境中运行，由 Vercel 管理服务器');
}

// 为 Vercel Serverless Functions 导出应用
module.exports = app;