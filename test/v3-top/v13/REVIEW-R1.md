# 规则审查R1修复

负责人Sol；实现依据Elara在dm:@Elara:fa82e395的c65e070d。独立初审来源：共享文档`Game Building/万物对战/开发归档/第13版规则只读审查/RESULT.md`，Iris审bbaaeb7..622fdd0，7条原均为建议；Lead将第1条升为阻塞，其余六条延后，不在本次修。

改变的只有反馈：一次有效挡窗内，真实新接触中被判为受击方便产生一次成功；不再等伤害分支。`damageApplied:false`给前端小号成功反馈，不触发弹反事件或慢放；正伤害成功为true。减伤、伤害冷却、冲刺与反冲规则完全沿用。一次窗第一次成功后不再重复发结果。

边界证据见review-r1-tests.txt（31项全过）；冷却样本的第一击0.2167秒，第二次真实新接触1.0417秒，时差0.825秒，挡在第二次接触的同一步按下。第二次没有伤害，修前期满报empty，修后同接触步报perfect+damageApplied:false。另验仅作为攻方接触仍empty，不把反震算守方命中。

review-r1-proof.mjs固定读取622fdd0原实现，与修后跑相同输入；受控冷却样本、正式择时种子7、正式乱按种子42，删去blockResult后完整回放JSON逐字节一致。所有帧、HP、随机结果、有效按键、其他事件和结算都不变。前端独立实现由Iris接字段、Sol只读复核；修复规则交Iris复审。未合main、未部署。

## 冲量门槛复核（Elara 801b66b4、9648d295；10-29 00:3x）

33c29bd已有门槛：sim/v3.js:233的newEpisode要求impulse≥minimumImpulse，第262行接住判定继承它。Iris 11ae099f核对后撤回“漏门槛”的建议；Elara要求用同窗先擦后撞的边界证明，再交Iris复核。生产代码不改，也不增加重复判断。

新增测试以第124步按挡，在该步给接触读取层注入0.0005的低冲量接触（门槛0.001），第125步仍是Rapier实际算出的4.380655288696289冲量。注入仅在测试内，不改变刚体、求解器、位置或速度；maxDuration=1.3、spinRate=0只在内存里覆盖。第124步没有contact/扣血/反冲/挡结果，第125步才出唯一perfect+damageApplied:false。**32/32通过**，见guard-threshold-tests.txt。

负对照在内存模块中仅删去newEpisode的冲量条件，同一输入立即在第124步错误占窗；原源码SHA256前后均为5a32a8f9dc5eb2371530d2080bf083b8387bccd14245e97d3afabb4fbacd1a82。复现入口guard-threshold-proof.mjs，原始接触输入、两版结果和完整回放SHA见guard-threshold-proof.json。此为受控边界测试，不冒充自然实局中已观察到0.0005的擦碰。
