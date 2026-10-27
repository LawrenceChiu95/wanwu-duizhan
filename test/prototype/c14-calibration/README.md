# 隔离校准证据索引

这些文件按试验时的代码和参数留证，不能当当前固定版。当前规则只看 ../selection.json、仓库根data/catalog.json和 ../verification.json。

- counter：早期克制倍率；cooldown/softer：概率暴击引入后的统一计伤间隔尝试。sources/内对应目录是实际代码与catalog-base；每个顶层JSON的parameters是对基线arena的覆盖项。
- all-counter-off：裁决22以前的速度版，关攻守倍率和B攻击克制，用于旧每算法9对0胜归因。
- before-momentum：速度版的完整模拟、数据、单件、生成物、拼装与锅诊断，已被裁决22替代。
- momentum-thrust：实心质量×速度的7档统一推力，未救回锅通吃/拖鞋全败。
- momentum-counter-off：实心质量×速度的关闭克制对照。
- solid-momentum：固定推力0.75、实心质量×速度阶段的实际代码/数据/结果。
- mass-options：裁决23三案。甲品类质量×速度；乙实心质量开方×速度；丙品类质量开方×速度。每案同280单件+100生成替换+972拼装。名义质量表保存在sources/mass-options/item-standards.json，realMasses=true表示按类别替换item.mass；false沿catalog-base。未实物称量。
- category-A-damage：选丙后只试A统一系数150、200，B和其他值冻结；两案未同时守线，最终退回100。
- final-counter-off：当前丙系数100的纯关闭对照，攻守倍率1、matchups空；对应当前COUNTERS。

sources/保存每批实际index/math/batch与基线catalog；本轮后三批另保存layouts/package/品类标准。每个JSON保存本案全部行与wallSeconds。临时目录路径仅是运行来源记录，归档核对后移废纸篓；重建时把源码置于sim/，catalog-base置于data/catalog.json，按parameters覆盖arena；disableMatchups=true清空matchups，realMasses=true按category从item-standards替换mass。安装固定Rapier依赖后，调用runBatch({includeGenerated:true})、runLayouts与runGeneratedComparison。

此前一次layouts漏参数的无效命令未替代最终结果；正式当前命令/退出状态见../c14-commands.json。
