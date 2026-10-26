# 探索证据

这些是历史隔离试验，不为当前代码背书。各JSON含运行时参数与数值，不删失败局。sources/rR2wiA是初版统一参数探索源码；5cG5Fl是反震比例探索源码；OpYvim是最终32次位置校正试验及探针。后者与正式8次不同，未采用。原临时目录清理后以此处留证；sources只是冻结源码，不含node_modules，可复用sim/package-lock.json依赖。tune-*.mjs按调用时源码建立新副本，重跑新源码不应期待复现旧数字。

正式来源是sim/index.js、data/catalog.json与verification.json；正式全量是batch/、layouts/、penetration-check.json、browser.json。projection32-probe.json的0.6毫米门槛失败、正式8次探针原0.6毫米门槛失败，AUDIT明确保留3.3毫米全步/2.8毫米回放误差；5毫米回归只防厘米级问题再出现，不作零穿模结论。
