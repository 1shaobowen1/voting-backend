/**
 * 投票小程序后端服务
 * 使用 Express + SQLite
 */

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// 数据库初始化
const db = new sqlite3.Database('./voting.db', (err) => {
    if (err) {
        console.error('❌ 数据库连接失败:', err);
    } else {
        console.log('✅ 数据库连接成功');
        initDatabase();
    }
});

// 初始化数据库表
function initDatabase() {
    db.serialize(() => {
        // 微信用户表
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            openid TEXT UNIQUE NOT NULL,
            nickname TEXT,
            avatar TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 投票表
        db.run(`CREATE TABLE IF NOT EXISTS votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            creator_openid TEXT NOT NULL,
            creator_name TEXT,
            multiple_choice INTEGER DEFAULT 0,
            max_votes_per_user INTEGER DEFAULT 1,
            anonymous INTEGER DEFAULT 0,
            end_time DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 选项表
        db.run(`CREATE TABLE IF NOT EXISTS options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vote_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (vote_id) REFERENCES votes(id) ON DELETE CASCADE
        )`);

        // 投票记录表
        db.run(`CREATE TABLE IF NOT EXISTS vote_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vote_id INTEGER NOT NULL,
            option_id INTEGER NOT NULL,
            openid TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (vote_id) REFERENCES votes(id) ON DELETE CASCADE,
            FOREIGN KEY (option_id) REFERENCES options(id) ON DELETE CASCADE,
            UNIQUE(vote_id, option_id, openid)
        )`);

        console.log('✅ 数据库表初始化完成');
    });
}

// ========== 微信登录接口 ==========

// 微信登录（通过 code 获取 openid）
app.post('/api/login', async (req, res) => {
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({ error: '缺少 code 参数' });
    }

    try {
        // 实际项目中，需要调用微信 API 获取 openid
        // 这里简化处理，直接用 code 生成 openid
        const openid = `user_${code}_${Date.now()}`;
        
        // 保存或更新用户
        db.run(`INSERT OR REPLACE INTO users (openid) VALUES (?)`, [openid], function(err) {
            if (err) {
                console.error('保存用户失败', err);
                return res.status(500).json({ error: '登录失败' });
            }
            
            res.json({
                success: true,
                openid,
                userInfo: { openid }
            });
        });
    } catch (err) {
        console.error('登录错误', err);
        res.status(500).json({ error: '登录失败' });
    }
});

// ========== 投票列表接口 ==========

// 获取所有投票
app.get('/api/votes', (req, res) => {
    db.all(`
        SELECT v.*, 
               (SELECT COUNT(*) FROM vote_records WHERE vote_id = v.id) as total_votes,
               (SELECT COUNT(*) FROM options WHERE vote_id = v.id) as options_count
        FROM votes v 
        ORDER BY v.created_at DESC
    `, [], (err, votes) => {
        if (err) {
            console.error('获取投票列表失败', err);
            return res.status(500).json({ error: '获取失败' });
        }
        res.json({ success: true, votes: votes || [] });
    });
});

// ========== 投票详情接口 ==========

// 获取投票详情
app.get('/api/votes/:id', (req, res) => {
    const voteId = req.params.id;
    
    db.get('SELECT * FROM votes WHERE id = ?', [voteId], (err, vote) => {
        if (err || !vote) {
            return res.status(404).json({ error: '投票不存在' });
        }
        
        db.all('SELECT * FROM options WHERE vote_id = ? ORDER BY sort_order', [voteId], (err, options) => {
            if (err) {
                return res.status(500).json({ error: '获取选项失败' });
            }
            
            // 获取每个选项的投票数
            const promises = options.map(opt => {
                return new Promise((resolve, reject) => {
                    db.get('SELECT COUNT(*) as count FROM vote_records WHERE option_id = ?', [opt.id], (err, result) => {
                        opt.vote_count = result?.count || 0;
                        resolve(opt);
                    });
                });
            });
            
            Promise.all(promises).then(optionsWithCount => {
                res.json({
                    success: true,
                    vote,
                    options: optionsWithCount
                });
            });
        });
    });
});

// ========== 创建投票 ==========

app.post('/api/votes', (req, res) => {
    const { title, description, options, multiple_choice, max_votes_per_user, anonymous, end_time, openid } = req.body;
    
    if (!title || !options || !Array.isArray(options) || options.length < 2) {
        return res.status(400).json({ error: '投票标题和至少两个选项' });
    }
    
    if (!openid) {
        return res.status(401).json({ error: '请先登录' });
    }

    // 获取创建者信息
    db.get('SELECT * FROM users WHERE openid = ?', [openid], (err, user) => {
        if (err) {
            return res.status(500).json({ error: '获取用户信息失败' });
        }
        
        const creatorName = user?.nickname || '匿名用户';
        
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            // 创建投票
            db.run(`
                INSERT INTO votes (title, description, creator_openid, creator_name, multiple_choice, max_votes_per_user, anonymous, end_time) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [title, description || '', openid, creatorName, multiple_choice ? 1 : 0, max_votes_per_user || 1, anonymous ? 1 : 0, end_time || null], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    console.error('创建投票失败', err);
                    return res.status(500).json({ error: '创建投票失败' });
                }
                
                const voteId = this.lastID;
                
                // 插入选项
                const stmt = db.prepare('INSERT INTO options (vote_id, content, sort_order) VALUES (?, ?, ?)');
                options.forEach((content, index) => {
                    stmt.run(voteId, content, index);
                });
                stmt.finalize((err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: '添加选项失败' });
                    }
                    
                    db.run('COMMIT');
                    res.json({
                        success: true,
                        voteId,
                        message: '投票创建成功'
                    });
                });
            });
        });
    });
});

// ========== 投票操作 ==========

// 检查投票状态
app.get('/api/votes/:id/check', (req, res) => {
    const voteId = req.params.id;
    const { openid } = req.query;
    
    if (!openid) {
        return res.json({ voted: false, votedCount: 0, maxVotes: 1 });
    }
    
    db.get('SELECT max_votes_per_user FROM votes WHERE id = ?', [voteId], (err, vote) => {
        const maxVotes = vote?.max_votes_per_user || 1;
        
        db.all('SELECT option_id FROM vote_records WHERE vote_id = ? AND openid = ?', [voteId, openid], (err, records) => {
            const votedCount = records?.length || 0;
            const votedOptionIds = records?.map(r => r.option_id) || [];
            res.json({
                voted: votedCount >= maxVotes,
                votedCount,
                maxVotes,
                votedOptionIds
            });
        });
    });
});

// 提交投票
app.post('/api/votes/:id/vote', (req, res) => {
    const voteId = req.params.id;
    const { openid, option_ids } = req.body;
    
    if (!openid) {
        return res.status(401).json({ error: '请先登录' });
    }
    
    if (!option_ids || !Array.isArray(option_ids) || option_ids.length === 0) {
        return res.status(400).json({ error: '请选择选项' });
    }
    
    // 检查投票是否存在
    db.get('SELECT * FROM votes WHERE id = ?', [voteId], (err, vote) => {
        if (err || !vote) {
            return res.status(404).json({ error: '投票不存在' });
        }
        
        // 检查截止时间
        if (vote.end_time && new Date(vote.end_time) < new Date()) {
            return res.status(400).json({ error: '该投票已截止' });
        }
        
        // 获取该用户已投的选项列表
        db.all('SELECT option_id FROM vote_records WHERE vote_id = ? AND openid = ?', [voteId, openid], (err, existingVotes) => {
            if (err) {
                return res.status(500).json({ error: '检查投票状态失败' });
            }
            
            const existingOptionIds = new Set(existingVotes.map(r => r.option_id));
            const alreadyVotedCount = existingOptionIds.size;
            const maxVotes = vote.max_votes_per_user || 1;
            
            // 验证：不能重复投同一个选项
            for (const optionId of option_ids) {
                if (existingOptionIds.has(optionId)) {
                    return res.status(400).json({ error: '您已投过该选项，不能重复投票' });
                }
            }
            
            // 验证：不能超过每人最大票数
            if (alreadyVotedCount + option_ids.length > maxVotes) {
                return res.status(400).json({
                    error: `您最多还能投 ${maxVotes - alreadyVotedCount} 票，已选择 ${option_ids.length} 项`
                });
            }
            
            // 检查选项是否属于该投票
            db.all('SELECT id FROM options WHERE vote_id = ?', [voteId], (err, validOptions) => {
                if (err) {
                    return res.status(500).json({ error: '选项验证失败' });
                }
                const validOptionIds = new Set(validOptions.map(o => o.id));
                for (const optionId of option_ids) {
                    if (!validOptionIds.has(optionId)) {
                        return res.status(400).json({ error: '存在无效的选项' });
                    }
                }
                
                // 插入投票记录
                const stmt = db.prepare('INSERT INTO vote_records (vote_id, option_id, openid) VALUES (?, ?, ?)');
                const errors = [];
                
                option_ids.forEach(optionId => {
                    try {
                        stmt.run(voteId, optionId, openid);
                    } catch (err) {
                        errors.push(err.message);
                    }
                });
                
                stmt.finalize((err) => {
                    if (err || errors.length > 0) {
                        console.error('投票失败', err, errors);
                        return res.status(500).json({ error: '投票失败' });
                    }
                    
                    res.json({
                        success: true,
                        message: '投票成功'
                    });
                });
            });
        });
    });
});

// ========== 结果接口 ==========

// 获取投票结果
app.get('/api/votes/:id/results', (req, res) => {
    const voteId = req.params.id;
    
    db.all(`
        SELECT o.id, o.content, COUNT(vr.id) as count 
        FROM options o 
        LEFT JOIN vote_records vr ON o.id = vr.option_id 
        WHERE o.vote_id = ? 
        GROUP BY o.id
        ORDER BY count DESC, o.sort_order
    `, [voteId], (err, results) => {
        if (err) {
            console.error('获取结果失败', err);
            return res.status(500).json({ error: '获取结果失败' });
        }
        res.json({ success: true, results });
    });
});

// ========== 我的投票 ==========

// 获取我创建的投票
app.get('/api/my-votes', (req, res) => {
    const { openid } = req.query;
    
    if (!openid) {
        return res.status(401).json({ error: '请先登录' });
    }
    
    db.all(`
        SELECT v.*, 
               (SELECT COUNT(*) FROM vote_records WHERE vote_id = v.id) as total_votes,
               (SELECT COUNT(*) FROM options WHERE vote_id = v.id) as options_count
        FROM votes v 
        WHERE v.creator_openid = ?
        ORDER BY v.created_at DESC
    `, [openid], (err, votes) => {
        if (err) {
            return res.status(500).json({ error: '获取失败' });
        }
        res.json({ success: true, votes: votes || [] });
    });
});

// 获取我参与的投票
app.get('/api/my-voted', (req, res) => {
    const { openid } = req.query;
    
    if (!openid) {
        return res.status(401).json({ error: '请先登录' });
    }
    
    db.all(`
        SELECT DISTINCT v.*, 
               (SELECT COUNT(*) FROM vote_records WHERE vote_id = v.id) as total_votes,
               vr.created_at as voted_at
        FROM votes v 
        INNER JOIN vote_records vr ON v.id = vr.vote_id
        WHERE vr.openid = ?
        ORDER BY vr.created_at DESC
    `, [openid], (err, votes) => {
        if (err) {
            return res.status(500).json({ error: '获取失败' });
        }
        res.json({ success: true, votes: votes || [] });
    });
});

// ========== 管理接口 ==========

// 删除投票
app.delete('/api/votes/:id', (req, res) => {
    const voteId = req.params.id;
    const { openid } = req.body;
    
    db.get('SELECT * FROM votes WHERE id = ?', [voteId], (err, vote) => {
        if (err || !vote) {
            return res.status(404).json({ error: '投票不存在' });
        }
        
        if (vote.creator_openid !== openid) {
            return res.status(403).json({ error: '无权删除此投票' });
        }
        
        db.serialize(() => {
            db.run('DELETE FROM vote_records WHERE vote_id = ?', [voteId]);
            db.run('DELETE FROM options WHERE vote_id = ?', [voteId]);
            db.run('DELETE FROM votes WHERE id = ?', [voteId], function(err) {
                if (err) {
                    return res.status(500).json({ error: '删除失败' });
                }
                res.json({ success: true, message: '删除成功' });
            });
        });
    });
});

// ========== 二维码生成 ==========

const QRCode = require('qrcode');

// 生成投票二维码图片
app.get('/api/qrcode/:voteId', async (req, res) => {
    const voteId = req.params.voteId;
    
    try {
        // 编码投票信息
        const qrData = JSON.stringify({
            type: 'vote',
            id: parseInt(voteId)
        });
        
        // 生成二维码SVG
        const qrSvg = await QRCode.toString(qrData, {
            type: 'svg',
            width: 300,
            margin: 2,
            color: {
                dark: '#667eea',
                light: '#ffffff'
            }
        });
        
        res.setHeader('Content-Type', 'image/svg+xml');
        res.send(qrSvg);
    } catch (err) {
        console.error('生成二维码失败', err);
        res.status(500).json({ error: '生成二维码失败' });
    }
});

// ========== 静态文件 ==========

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== 启动服务器 ==========

app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('   🗳️  投票小程序后端服务启动成功！');
    console.log('═══════════════════════════════════════════');
    console.log(`   📡 服务地址: http://localhost:${PORT}`);
    console.log(`   📱 小程序访问: http://YOUR_IP:${PORT}`);
    console.log('═══════════════════════════════════════════');
    console.log('');
});
