# 各国权威榜单名

写于 2026-11-06。按国家列出能查到的榜单正式名称，方便挑选要放进「官方榜」的条目。播放仍用设置里的平台搜索，这里只列榜的名字和它统计什么。

歌曲榜优先。专辑榜单独标出，因为点进去没法按单曲搜索。

## 截图里那六张「全球榜」

2026-11-06 核对。播放器的 `getTopLists` 不是 GitHub 上的公开接口，只是插件脚本自己要实现的函数。现成音源脚本通常不实现它，所以装上插件后排行榜里不会出现这六张卡。

这六张卡的名字和 id 写在洛雪客户端源码里，文件是 `lyswhut/lx-music-desktop` 的 `src/renderer/utils/musicSdk/wy/leaderboard.js`。它们是网易云歌单，不是 Billboard、Oricon、NRJ、TopHit、Beatport 官网。榜上的歌是网易云收录进这些歌单的版本，可能比官网晚。

浏览器打开下面任一地址，把 `{id}` 换成表里的数字，就能看到当前歌单，用来对比是不是最新：

```text
https://music.163.com/#/discover/toplist?id={id}
https://music.163.com/#/playlist?id={id}
```

| 卡片上的名字 | 源码里的名字 | 歌单 id |
| --- | --- | --- |
| 美国公告牌榜 | 美国Billboard榜 | 60198 |
| 英国UK榜 | UK排行榜周榜 | 180106 |
| 日本公信榜 | 日本Oricon榜 | 60131 |
| 法国NJR榜 | 法国 NRJ Vos Hits 周榜 | 27135204 |
| 俄罗斯流行榜 | 俄罗斯top hit流行音乐榜 | 6939992364 |
| 全球电子舞曲榜 | Beatport全球电子舞曲榜 | 3812895 |

同一份源码的酷我榜（`kw/leaderboard.js`）里有 Billboard、英国UK榜、日本公信榜、beatport电音榜，没有法国 NRJ 和俄罗斯 TopHit。

播放器排行榜页最前面的「官方榜」用的就是这六个歌单。每次点开都会重新请求。歌曲用设置里「官方榜播放平台」选中的音源搜索后播放。

## 美国

机构：Billboard。综合榜每周更新，歌曲同时看销量、流媒体和广播。

| 榜单名 | 统计什么 |
| --- | --- |
| Billboard Hot 100 | 美国综合单曲榜，主榜 |
| Billboard Global 200 | 全球 200 多个地区的销量和流媒体 |
| Billboard Global Excl. U.S. | 全球榜，去掉美国 |
| Streaming Songs | 只看流媒体 |
| Digital Song Sales | 只看下载 |
| Radio Songs | 只看广播 |
| Pop Airplay | 流行电台 |
| Adult Pop Airplay | 成人流行电台 |
| Adult Contemporary | 成人当代电台 |
| Hot Country Songs | 乡村 |
| Hot R&B/Hip-Hop Songs | R&B / 嘻哈 |
| Hot Rap Songs | 说唱 |
| Dance/Electronic Songs | 舞曲 / 电子 |
| Hot Rock & Alternative Songs | 摇滚 / 另类 |
| Hot Latin Songs | 拉丁 |
| Billboard 200 | 专辑综合榜 |

苹果美国店另有一份每天更新的歌榜，名字是 Top Songs。

## 英国

机构：Official Charts Company。单曲榜每周公布，BBC Radio 1 报的是其中的 Top 40。官网称带 Official 字样的榜超过 50 个，下面是和听歌直接相关的。

| 榜单名 | 统计什么 |
| --- | --- |
| Official Singles Chart | 英国官方单曲榜 Top 100，主榜 |
| Official Albums Chart | 官方专辑榜 |
| Official Compilations Chart | 合辑 |
| Official Streaming Chart | 流媒体 |
| Official Audio Streaming Chart | 音频流媒体 |
| Official Video Streaming Chart | 视频流媒体 |
| Official Sales Chart | 销量 |
| Official Download Chart | 下载，单曲和专辑都有 |
| Official Physical Chart | 实体，单曲和专辑都有 |
| Official Vinyl Chart | 黑胶，单曲和专辑都有 |
| Official Dance Chart | 舞曲，单曲和专辑都有 |
| Official Hip Hop and R&B Chart | 嘻哈 / R&B，单曲和专辑都有 |
| Official Rock & Metal Chart | 摇滚 / 金属，单曲和专辑都有 |
| Official Independent Chart | 独立厂牌，单曲和专辑都有 |
| Official Independent Breakers Chart | 独立新晋 |
| Official Afrobeats Chart | Afrobeats |
| Official Irish Singles Chart | 爱尔兰单曲，同一机构在编 |
| Official Irish Albums Chart | 爱尔兰专辑 |

苹果英国店的对应歌榜也叫 Top Songs。

## 其他欧美国家

这些是该国现在还在用的主榜，不是电台自己排的节目榜。

| 国家 | 榜单名 | 机构 |
| --- | --- | --- |
| 德国 | Offizielle Deutsche Top 100 | GfK / 德国官方榜 |
| 法国 | Top Singles | SNEP |
| 法国 | Top Albums | SNEP |
| 加拿大 | Canadian Hot 100 | Billboard |
| 澳大利亚 | ARIA Singles Chart | ARIA |
| 澳大利亚 | ARIA Albums Chart | ARIA |
| 荷兰 | Single Top 100 | Dutch Charts |
| 荷兰 | Nederlandse Top 40 | 广播榜，和 Single Top 100 不是同一份 |
| 瑞典 | Sverigetopplistan | 瑞典官方榜 |
| 挪威 | VG-lista | VG |
| 瑞士 | Schweizer Hitparade | 瑞士官方榜 |
| 意大利 | FIMI Singles Chart | FIMI |
| 西班牙 | Top 100 Canciones | PROMUSICAE |
| 爱尔兰 | Official Irish Singles Chart | Official Charts |

## 俄罗斯

没有一份全国统一的官方总榜。下面是现在还在公开更新、名字固定的几份。

| 榜单名 | 谁在做 | 统计什么 |
| --- | --- | --- |
| Top Radio Hits Russia | TopHit | 俄罗斯广播播放，周榜 |
| Top YouTube Hits Russia | TopHit | 俄罗斯 YouTube |
| Top Spotify Hits Russia | TopHit | 俄罗斯 Spotify |
| Top All Internet Hits Russia | TopHit | 互联网合计：Яндекс Музыка、VK、Звук、OK、iTunes、Apple，再加 YouTube 周数据 |
| Top All Media Hits Russia | TopHit | 广播和互联网合在一起 |
| Top Artists Russia | TopHit | 歌手榜，不是单曲 |
| Apple Music Топ-песни | Apple | 俄罗斯店最常播放的歌 |
| Яндекс Музыка  чарт | Яндекс | 平台自己的榜，TopHit 的互联网榜会收它 |
| VK Музыка чарт | VK | 平台自己的榜 |
| Звук чарт | Звук | 平台自己的榜 |
| Shazam Россия | Shazam | 听歌识曲次数 |

TopHit 还有月榜、季榜、年榜，以及 New（发行三个月内）和 Trend（涨得最快）。上面列的是周榜主名。

## 韩国

两套不要混。Circle 是产业协会的全国统计，一周一次。Melon、Genie、Bugs、FLO、VIBE 是各平台自己的实时榜。

### Circle Chart（原 Gaon Chart）

机构：韩国大众音乐产业协会。周榜一般周四 11:00 公布。

| 榜单名 | 统计什么 |
| --- | --- |
| Global K-pop Chart | 全球 K-pop 流媒体 |
| Digital Chart | 下载、流媒体、BGM、视频彩铃，按平台加权 |
| Streaming Chart | 流媒体 |
| Download Chart | 下载 |
| BGM Chart | 背景音乐使用 |
| Album Chart | 专辑出货 |
| Retail Album Chart | 实体店零售 |
| Social Chart | 社交和带原曲的视频 |
| Karaoke Chart | 卡拉 OK |
| Mobile Chart | 手机铃声等 |

Digital、Streaming、Download、Global K-pop 都有周榜、月榜、半年榜、年榜。

### 平台实时榜

| 榜单名 | 平台 | 统计什么 |
| --- | --- | --- |
| Melon TOP100 | Melon | 近 24 小时和近 1 小时合算，大约每小时更新 |
| Melon HOT100 | Melon | 发行 30 天或 100 天内的新歌，按近 1 小时 |
| Melon 日间榜 | Melon | 一天用量 |
| Melon 周间榜 | Melon | 一周用量 |
| Melon 月间榜 | Melon | 一月用量 |
| Genie 实时榜 | Genie | 约每小时，凌晨 1 点到 7 点不更新 |
| Genie 日间榜 | Genie | 日 |
| Genie 周间榜 | Genie | 周 |
| Bugs 实时榜 | Bugs | 实时 |
| Bugs 日间榜 | Bugs | 日 |
| Bugs 周间榜 | Bugs | 周 |
| FLO 实时榜 | FLO | 平台实时 |
| VIBE 实时榜 | VIBE | 平台实时 |
| Hanteo Chart | Hanteo | 实体专辑实时销量为主 |
| iChart | instiz | 把 Melon、Genie、FLO、Bugs、VIBE、YouTube Music 合成一份实时总榜 |

苹果韩国店的歌榜名是 인기곡（Top Songs）。

## 日本

### Billboard Japan

综合歌曲榜每周三下午公布。第 21 名往后，官网写明只给付费会员完整转载。

| 榜单名 | 统计什么 |
| --- | --- |
| Japan Hot 100 | 综合单曲：CD、下载、流媒体、广播、视频、卡拉 OK |
| Streaming Songs | 流媒体 |
| Download Songs | 单曲下载 |
| Top Singles Sales | 实体单曲 |
| Hot Animation | 动漫、游戏歌曲 |
| Hot Overseas | 欧美歌手在日本的歌 |
| Top User Generated Songs | 用户上传视频 |
| Heatseekers Songs | 没进过 Hot 100 前 20 的新人歌 |
| Hot Shot Songs | 比上周涨得最多 |
| Niconico Vocaloid Songs Top 20 | NicoNico 上的 Vocaloid |
| Global Japan Songs Excl. Japan | 日本歌曲在海外 |
| Japan Songs（按国家） | 日本歌曲在韩国、美国、英国、台湾等地的分榜 |
| Artist 100 | 歌手 |
| Hot 100 Lyricists | 作词 |
| Hot 100 Composers | 作曲 |
| Hot Albums | 专辑综合 |
| Top Albums Sales | 实体专辑 |
| Download Albums | 专辑下载 |

### Oricon（オリコン）

完整名次在付费服务里。免费站只给前面一段。名字是这些：

| 榜单名 | 大约何时出 |
| --- | --- |
| デイリーシングルランキング | 每天 |
| デイリーアルバムランキング | 每天 |
| 週間シングルランキング | 每周三 |
| 週間アルバムランキング | 每周三 |
| 週間デジタルシングルランキング | 每周四 |
| 週間デジタルアルバムランキング | 每周四 |
| 週間ストリーミングランキング | 每周四 |
| 週間合算シングルランキング | 每周五，实体加数字合算 |
| 週間合算アルバムランキング | 每周五 |

苹果日本店的歌榜名是 トップソング（Top Songs）。

## 同一套、按国家拆开的苹果榜

苹果每个国家店都有同一种歌榜，正式产品名是 Top Songs（当地语言会翻译）。今天测过、能返回歌名和歌手的有：

| 国家 | 当地榜名 | 代码 |
| --- | --- | --- |
| 美国 | Top Songs | us |
| 英国 | Top Songs | gb |
| 俄罗斯 | Топ-песни | ru |
| 韩国 | 인기곡 | kr |
| 日本 | トップソング | jp |

地址形式：

```text
https://rss.applemarketingtools.com/api/v2/{代码}/music/most-played/{条数}/songs.json
```

这是最常播放，不是上表那些周销量综合榜。单榜点击刷新可以用。一次连拉好几个 100 首，今天出现过超时和 502。
