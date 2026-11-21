# CoolCart

CrossPointX 2026 逆向 UX 赛道的购物车原型，支持 iOS App 和网页。商品放行后可以打开原商品页，返回购物车并自报实付。首页「查看支出」展示已确认的付款，以及按北京时间统计的本周和本月合计。

## 在线演示

[打开 CoolCart 网页演示](https://raphael-he01.github.io/CoolCart/)

从「导入或手填」选择单品截图、购物车截图、商品分享链接或手填。网页购物车截图先显示预览，用户确认后由联网服务识别出多个商品，按规格补查价格和购买页。请先裁去姓名、地址和手机号。入库后等待 30 秒，完成餐费题、两项购买问题和购买前提醒。网页购物车和账本保存在当前浏览器。iOS 版另有 Apple Vision 本机识别、系统相册分享和实时屏幕共享入口。

网页演示由 GitHub Pages 托管。构建联网演示时运行 `VITE_COOLCART_STATIC_DEMO=1 VITE_COOLCART_API_ORIGIN=https://你的后端 npm run build -- --base=/CoolCart/`。后端需要允许演示网页的来源。密钥只配置在后端。省略 API 来源时，Pages 版使用手填、分享链接和内置问答。发布分支 `gh-pages` 的根目录包含构建产物。

## 在 iPhone 上运行

1. 在仓库根目录运行 `npm ci`，然后用 Xcode 打开 `ios/CoolCart.xcodeproj`。
2. 选择 `CoolCart` 方案和 iPhone 模拟器，点 ▶︎ 运行。真机首次运行时，在手机上启用开发者模式，在 Xcode 的 `Signing & Capabilities` 选择个人开发团队，然后选已连接的手机运行。本机也可用 Git 忽略的 `ios/Signing.local.xcconfig` 保存 `DEVELOPMENT_TEAM`。[Apple 真机运行说明](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)
3. 安装后从主屏幕打开「CoolCart」。手填、分享链接整理、冷静流程和账本均可离线使用。配置个人密钥或团队导入接口并联网后，App 可以查商品链接，也可以选取单件商品截图进行识别。

### 为自己的 iPhone 配置或轮换 DeepSeek 密钥

先将个人密钥填入 Mac 上项目根目录的 `.env.local`，变量名为 `DEEPSEEK_API_KEY`。把当前 Debug 版安装到自己的 iPhone，保持配对并解锁，在项目根目录运行：

```sh
node ios/configure-personal-key.mjs "设备名称或设备标识"
```

看到「iPhone 已确认个人密钥写入钥匙串」即可从 App 直接查商品。钥匙串项目仅在这部已解锁的 iPhone 上可用。轮换时先更新 `.env.local`，再运行同一命令。团队分发版可在构建前把托管服务的完整 HTTPS 导入地址写入 `ios/CoolCart/ImportEndpoint.local.txt`，例如 `https://你的项目地址/api/import-product`。同域的 `/api/purchase-review` 提供购买问答。该文件只写网址，服务密钥留在服务端。验收新装时，使用未配置个人密钥的 iPhone 检查选图识别和问答。

从 iPhone 主屏幕打开时，Debug 测试版中新加入且命中锁定规则的商品初始冷静 30 秒，Release 正式版为 24 小时。更新前已入库的商品保留原截止时间。Xcode 的 `Edit Scheme → Run → Arguments` 中预置了 `--demo`，勾选后使用独立的演示购物车和账本。App 的数据保存在自己的容器内，Safari 先前保存的记录在原网页中查看。

## 从 iPhone 购物车页面识别商品

先在购物 App 的购物车页截屏，然后在 iPhone 打开 CoolCart，点「导入或手填」，展开「购物车截屏识别」并点「选择购物车截屏」。选中一张图后立即在本机识别，不需要屏幕共享。截屏应包含购物车标题和希望导入的完整商品行。

如希望边滚动边识别，iOS 27 或更新版本可以展开「实时屏幕共享」，按系统提示开始。回到 CoolCart 时，共享会自动停止。

待核对列表显示本机识别出的商品、规格和能对应到该商品的可见单价。逐件点「填入商品草稿」，核对后再加入购物车。缺少购买链接或单价时，可点「查找已填商品」查询同款，或手动补填。

购物车截屏的图片和文字识别保存在本机。配置联网服务后，商品入库或进入待核对区时会按名称、规格和平台补查商品资料。单品截图的 DeepSeek 识图会将选中的图片提交给识别服务。

## 本地运行

建议使用 Node.js 22.12 或更新的 LTS 版本。在仓库根目录执行：

```sh
npm ci
npm run lint
npm run build
npm run dev
```

打开终端给出的地址。在网页地址后加 `?demo=1` 进入演示模式，初始冷静期为 30 秒。普通模式的初始冷静期为 24 小时。两种模式各自保存设置、显示商品和统计支出。iPhone 与 Mac 连到同一个可信 Wi-Fi 或热点后，可运行 `npm run dev -- --host 0.0.0.0`，用 Safari 打开终端给出的局域网地址并加上 `?demo=1`。

## 首轮演示

1. 打开「导入或手填」，填入耳机、单价 399 元、类别「数码」和已核对的商品链接。也可以先留空链接，放行后再补。
2. 等倒计时结束，进入餐费换算。每顿按默认 15 元计算，结果约为 27 顿。答错也能继续。分别回答两个购买问题，查看 DeepSeek 提醒和可以点击的购买入口。
3. 查看购买前预算区，点击「打开原商品页」。返回购物车后查看「待确认」，填写实际支付的金额和时间，确认后到「查看支出」核对记录。

首次使用默认锁定所有商品。可在「设置」取消全锁，选择品类或启用单价门槛，保存后对新加入的商品生效。预算预览使用商品标价，账本使用确认的实付金额。

## 部署

可用 Vercel 部署同一次提交的前端以及 `api/import-product.js` 和 `api/purchase-review.js`。选择 **Vite**，Root Directory 指向含 `package.json` 和 `api/` 的仓库根目录，Build Command 为 `npm run build`，Output Directory 为 `dist`。 [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)

1. 在对应部署环境配置 `DEEPSEEK_API_KEY`、`UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN`。前端和 App 只访问托管接口。两条接口共用每小时的项目配额和匿名客户端配额，默认分别为 200 和 30 次。可通过 `COOLCART_AI_HOURLY_LIMIT` 与 `COOLCART_AI_PER_IP_HOURLY_LIMIT` 调整。Upstash 通过一条原子命令记录配额。 [Upstash Redis REST](https://upstash.com/docs/redis/features/restapi) · [Vercel 请求头](https://vercel.com/docs/headers/request-headers)
2. 上限用尽时返回 `429` 和 `Retry-After`。配额服务未配置或不可达时返回 `503`。用户仍可手填，并用本地问答继续。使用独立预览环境和较小的测试上限验证这些行为，再设定正式额度。Vite 本地开发和个人密钥直连可独立调试。
3. 从匿名设备验证生产网址的 `/?demo=1`、商品导入与购买问答。用未配个人密钥的 iPhone 安装指向该网址的构建，核对选图识别、查同款和两项问答。公布网址前实测京东购物车兜底、真实商品落地及本机通知。 [Vercel 部署保护](https://vercel.com/docs/deployment-protection)

## DeepSeek 导入、购买问答和手填回退

复制 `.env.example` 为 `.env.local`，在本机填入服务端变量 `DEEPSEEK_API_KEY` 并重启开发服务。托管环境按上面的部署步骤配置密钥和配额。 [Vercel 环境变量](https://vercel.com/docs/environment-variables)

- 在网页或 iPhone App 的「上传单件商品截图」选择文件。预览后点「用 DeepSeek 识别并找同款」。支持最大 20 MB（20 MiB，含上限）的 PNG、JPEG 和 WebP。网页和团队接口会在设备上压缩超过 3 MiB 的图片后再上传，优先保留像素尺寸。iPhone 个人密钥直连模式上传原图。App 读取截图中的型号，搜索同款并自动填入有依据的商品名称、类别、单价和购买链接。能核实主图和商品资料时，草稿和商品详情会展示匹配结果，购物车列表会显示缩略图。商品详情截图明确写明的券后或补贴到手单价会标为「截图到手参考价」，实际优惠与付款金额以商城结算为准。
- 分享文案可以有多个链接。程序忽略说明页，遇到多个商品时先让用户选择。对能明确核对的京东主商品卡，直接读取公开标价，并由 DeepSeek 提取名称和规格；其他支持的链接尝试用 DeepSeek 读取和检索商品。登录后才可见的报价由用户补填。更换商品或已有报价的规格后需重新核价，手动改价会保留「手填」来源。
- 商品名称或型号可以直接查找。未指定平台时优先查京东；有多个可信匹配时先选择商品。可核对的公开单价才会回填。
- 冷静期和餐费题之后，DeepSeek 根据商品资料识别商品类型并生成两道问题。提交两个回答后生成购买前提醒，页面沿用购物车已保存的商品链接。点击购买入口时先记为「待确认支付」。
- 网页请通过 Vite 开发服务、预览服务或带两个 API 路由的部署打开。服务不可用时仍可手填，并用本地问题和提醒继续。缺少京东商品直链时，可打开京东购物车，复制商品名和规格到京东 App 搜索，也可补填链接。已经在商城完成购买的放行商品，可以主动「登记实付」。

[DeepSeek Vision](https://api-docs.deepseek.com/guides/vision/) · [Search & Fetch](https://api-docs.deepseek.com/guides/search/)

## 工具与许可证

原型使用 React、Vite 和 Oxlint，导入使用 DeepSeek 服务。首轮页面开发由 Codex 协助，本地浏览器检验使用 Chrome（含无头模式与 390 像素视口）。项目代码采用 Apache License 2.0，详见 `LICENSE`。Fusion Pixel 字体采用 SIL Open Font License 1.1，见 `public/fonts/OFL.txt`。
