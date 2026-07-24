# 🤗 Hugging Face 代理

基于 Cloudflare Workers 的 Hugging Face 代理服务，解决国内访问 Hugging Face 速度慢的问题。

## ✨ 功能特性

- ⚡ **加速下载** - 通过 Cloudflare CDN 加速模型和数据集下载
- 🔧 **API 代理** - 完整支持 Hugging Face Inference API
- 📦 **模型下载** - 支持 transformers、huggingface_hub、git-lfs
- 🔒 **安全可靠** - 纯代理转发，不存储任何数据
- 🌐 **CORS 支持** - 完整的跨域支持，前端可直接调用
- 🚀 **免费部署** - 基于 Cloudflare Workers，免费额度充足

## 🚀 快速开始

### 1. 部署到 Cloudflare

#### 方法一：GitHub Actions 自动部署（推荐）

1. **Fork 本仓库** 到你的 GitHub 账号

2. **获取 Cloudflare API Token**
   - 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
   - 点击 "Create Token"
   - 使用 "Edit Cloudflare Workers" 模板
   - 权限选择：
     - `Cloudflare Workers:Edit`
     - `Account:Read`
   - 创建并复制 Token

3. **获取 Account ID**
   - 在 Cloudflare Dashboard 右侧边栏查看 **Account ID**

4. **配置 GitHub Secrets**
   - 进入你 fork 的仓库 → Settings → Secrets and variables → Actions
   - 添加以下 Secrets：
     - `CLOUDFLARE_API_TOKEN`: 你的 API Token
     - `CLOUDFLARE_ACCOUNT_ID`: 你的 Account ID

5. **触发部署**
   - 推送任意代码到 `main` 分支，GitHub Actions 会自动部署
   - 或手动触发：Actions → Deploy to Cloudflare Workers → Run workflow

#### 方法二：本地部署

```bash
# 克隆仓库
git clone https://github.com/你的用户名/hf-proxy.git
cd hf-proxy

# 安装依赖
npm install

# 登录 Cloudflare
npx wrangler login

# 本地开发
npm run dev

# 部署
npm run deploy
```

### 2. 绑定自定义域名（可选）

1. 在 Cloudflare Dashboard 中进入你的 Workers 服务
2. 点击 "Triggers" → "Custom Domains"
3. 添加你的域名 `wzzyyds2011.de5.net`
4. 修改 `wrangler.toml` 中的路由配置（已配置好）：

```toml
routes = [
  { pattern = "wzzyyds2011.de5.net/*", custom_domain = true }
]
```

## 📖 使用指南

### Python - transformers

```python
from transformers import AutoModel, AutoTokenizer
import os

# 设置代理 endpoint
os.environ["HF_ENDPOINT"] = "https://wzzyyds2011.de5.net"

# 下载模型
model = AutoModel.from_pretrained("bert-base-chinese")
tokenizer = AutoTokenizer.from_pretrained("bert-base-chinese")
```

### Python - huggingface_hub

```python
from huggingface_hub import hf_hub_download
import os

os.environ["HF_ENDPOINT"] = "https://wzzyyds2011.de5.net"

# 下载特定文件
file_path = hf_hub_download(
    repo_id="bert-base-chinese",
    filename="config.json"
)
```

### cURL

```bash
# 下载模型文件
curl -L "https://wzzyyds2011.de5.net/bert-base-chinese/resolve/main/config.json"

# 调用 Inference API
curl -X POST "https://wzzyyds2011.de5.net/pipeline/sentiment-analysis/distilbert-base-uncased-finetuned-sst-2-english" \
  -H "Content-Type: application/json" \
  -d '{"inputs": "I love this product!"}'

# 获取模型信息
curl "https://wzzyyds2011.de5.net/api/models/bert-base-chinese"
```

### JavaScript

```javascript
// 调用推理 API
const response = await fetch('https://wzzyyds2011.de5.net/pipeline/sentiment-analysis/distilbert-base-uncased-finetuned-sst-2-english', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ inputs: "I love this product!" })
});

const result = await response.json();
console.log(result);
```

### Git LFS

```bash
# 设置环境变量
export HF_ENDPOINT=https://wzzyyds2011.de5.net

# 使用 huggingface-cli
huggingface-cli download bert-base-chinese

# 或者直接 git clone
git clone https://wzzyyds2011.de5.net/bert-base-chinese
```

## 🔌 支持的端点

| 端点 | 说明 |
|------|------|
| `/models/<model-id>` | 模型页面 |
| `/datasets/<dataset-id>` | 数据集页面 |
| `/spaces/<space-id>` | Spaces 页面 |
| `/api/models/<model-id>` | 模型 API |
| `/api/datasets/<dataset-id>` | 数据集 API |
| `/<model-id>/resolve/main/<file>` | 下载文件 |
| `/<model-id>/blob/main/<file>` | 查看文件 |
| `/pipeline/<task>/<model-id>` | 推理 API |

## 🛠️ 开发

```bash
# 安装依赖
npm install

# 本地开发（热重载）
npm run dev

# 查看日志
npm run tail

# 部署
npm run deploy
```

## 📁 项目结构

```
hf-proxy/
├── workers/
│   └── index.js          # Cloudflare Workers 主程序
├── .github/
│   └── workflows/
│       └── deploy.yml    # GitHub Actions 部署配置
├── wrangler.toml         # Wrangler 配置文件
├── package.json          # 项目依赖
├── .gitignore           # Git 忽略文件
└── README.md            # 项目文档
```

## ⚠️ 注意事项

1. **免费额度**：Cloudflare Workers 免费版每天有 100,000 次请求限制
2. **大文件下载**：单文件下载可能受 Workers 限制，建议使用 huggingface-cli
3. **速度限制**：代理速度取决于 Cloudflare 到 Hugging Face 的网络质量
4. **合规使用**：请遵守 Hugging Face 的使用条款

## 🔧 故障排除

### 部署失败

- 检查 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 是否正确设置
- 确保 API Token 有 `Cloudflare Workers:Edit` 权限

### 访问缓慢

- 检查 Cloudflare 节点位置
- 考虑使用 Cloudflare Pro 或 Business 计划

### 大文件下载失败

- Workers 有请求大小限制，建议使用 huggingface-cli 分段下载
- 可以配置 R2 存储作为缓存层

## 📄 许可证

MIT License

## 🙏 致谢

- [Hugging Face](https://huggingface.co) - 提供优秀的 AI 模型平台
- [Cloudflare Workers](https://workers.cloudflare.com) - 提供边缘计算平台
