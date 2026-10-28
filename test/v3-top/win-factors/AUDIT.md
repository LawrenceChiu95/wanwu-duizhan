# 单变量对照详细依据

基线e0566ee；旧4800局来自loadout-compare。新3600局输入、文件SHA和首次复放核验在results/inputs.json；每局在results/rounds.ndjson；结束回执在complete.json；派生统计在analysis.json，完整性复核在verification.json。生产sim/web/data未改。

## 逐格配对差及95%区间

A和B共享100种子。差=B胜率-A胜率；随机干预和操作干预的A都是原AI对AI；mash-vs-idle的A是不按、B是乱按。items的A/B方向以label为准。赢与没赢翻转率把平局作为没赢；winnerChanged另存三态输/赢/平变化。净差95%为配对差值正态近似，翻转95%为Wilson，不是独立二项率直接相减。未校正多重比较。

| 规则 | 因素 | 场景/配对 | A赢 | B赢 | 差及95%区间，点 | 赢/没赢翻转及95%区间 |
|---|---|---|---:|---:|---:|---:|
| ai-ai | 第一件伸出／贴着 | pan-broom:out-out-e180->hug-out-e180 | 49/100 | 56/100 | 7 [-7, 21] | 51% [41.3, 60.6] |
| ai-ai | 第一件伸出／贴着 | pan-broom:out-out-e90->hug-out-e90 | 68/100 | 46/100 | -22 [-35.8, -8.2] | 54% [44.3, 63.4] |
| ai-ai | 第一件伸出／贴着 | pan-broom:out-hug-e180->hug-hug-e180 | 69/100 | 40/100 | -29 [-40.9, -17.1] | 45% [35.6, 54.8] |
| ai-ai | 第一件伸出／贴着 | pan-broom:out-hug-e90->hug-hug-e90 | 49/100 | 44/100 | -5 [-18.8, 8.8] | 49% [39.4, 58.7] |
| ai-ai | 第二件伸出／贴着 | pan-broom:out-out-e180->out-hug-e180 | 49/100 | 69/100 | 20 [7.5, 32.5] | 44% [34.7, 53.8] |
| ai-ai | 第二件伸出／贴着 | pan-broom:out-out-e90->out-hug-e90 | 68/100 | 49/100 | -19 [-32.6, -5.4] | 51% [41.3, 60.6] |
| ai-ai | 第二件伸出／贴着 | pan-broom:hug-out-e180->hug-hug-e180 | 56/100 | 40/100 | -16 [-29.3, -2.7] | 48% [38.5, 57.7] |
| ai-ai | 第二件伸出／贴着 | pan-broom:hug-out-e90->hug-hug-e90 | 46/100 | 44/100 | -2 [-15.6, 11.6] | 48% [38.5, 57.7] |
| ai-ai | 两件挨着／对面 | pan-broom:out-out-e180->out-out-e90 | 49/100 | 68/100 | 19 [5.4, 32.6] | 51% [41.3, 60.6] |
| ai-ai | 两件挨着／对面 | pan-broom:out-hug-e180->out-hug-e90 | 69/100 | 49/100 | -20 [-33.9, -6.1] | 54% [44.3, 63.4] |
| ai-ai | 两件挨着／对面 | pan-broom:hug-out-e180->hug-out-e90 | 56/100 | 46/100 | -10 [-22.9, 2.9] | 44% [34.7, 53.8] |
| ai-ai | 两件挨着／对面 | pan-broom:hug-hug-e180->hug-hug-e90 | 40/100 | 44/100 | 4 [-9.6, 17.6] | 48% [38.5, 57.7] |
| ai-ai | 第一件伸出／贴着 | scissors-pillow:out-out-e180->hug-out-e180 | 24/100 | 26/100 | 2 [-9.8, 13.8] | 36% [27.3, 45.8] |
| ai-ai | 第一件伸出／贴着 | scissors-pillow:out-out-e90->hug-out-e90 | 20/100 | 23/100 | 3 [-8.3, 14.3] | 33% [24.6, 42.7] |
| ai-ai | 第一件伸出／贴着 | scissors-pillow:out-hug-e180->hug-hug-e180 | 29/100 | 34/100 | 5 [-7.9, 17.9] | 43% [33.7, 52.8] |
| ai-ai | 第一件伸出／贴着 | scissors-pillow:out-hug-e90->hug-hug-e90 | 22/100 | 24/100 | 2 [-10.5, 14.5] | 40% [30.9, 49.8] |
| ai-ai | 第二件伸出／贴着 | scissors-pillow:out-out-e180->out-hug-e180 | 24/100 | 29/100 | 5 [-6.3, 16.3] | 33% [24.6, 42.7] |
| ai-ai | 第二件伸出／贴着 | scissors-pillow:out-out-e90->out-hug-e90 | 20/100 | 22/100 | 2 [-9.1, 13.1] | 32% [23.7, 41.7] |
| ai-ai | 第二件伸出／贴着 | scissors-pillow:hug-out-e180->hug-hug-e180 | 26/100 | 34/100 | 8 [-4.7, 20.7] | 42% [32.8, 51.8] |
| ai-ai | 第二件伸出／贴着 | scissors-pillow:hug-out-e90->hug-hug-e90 | 23/100 | 24/100 | 1 [-10.7, 12.7] | 35% [26.4, 44.7] |
| ai-ai | 两件挨着／对面 | scissors-pillow:out-out-e180->out-out-e90 | 24/100 | 20/100 | -4 [-15.5, 7.5] | 34% [25.5, 43.7] |
| ai-ai | 两件挨着／对面 | scissors-pillow:out-hug-e180->out-hug-e90 | 29/100 | 22/100 | -7 [-20.1, 6.1] | 45% [35.6, 54.8] |
| ai-ai | 两件挨着／对面 | scissors-pillow:hug-out-e180->hug-out-e90 | 26/100 | 23/100 | -3 [-15.3, 9.3] | 39% [30, 48.8] |
| ai-ai | 两件挨着／对面 | scissors-pillow:hug-hug-e180->hug-hug-e90 | 34/100 | 24/100 | -10 [-22.3, 2.3] | 40% [30.9, 49.8] |
| ai-ai | 第一件伸出／贴着 | lamp-slipper:out-out-e180->hug-out-e180 | 30/100 | 26/100 | -4 [-16.7, 8.7] | 42% [32.8, 51.8] |
| ai-ai | 第一件伸出／贴着 | lamp-slipper:out-out-e90->hug-out-e90 | 39/100 | 25/100 | -14 [-26.5, -1.5] | 42% [32.8, 51.8] |
| ai-ai | 第一件伸出／贴着 | lamp-slipper:out-hug-e180->hug-hug-e180 | 48/100 | 31/100 | -17 [-30.7, -3.3] | 51% [41.3, 60.6] |
| ai-ai | 第一件伸出／贴着 | lamp-slipper:out-hug-e90->hug-hug-e90 | 35/100 | 39/100 | 4 [-9, 17] | 44% [34.7, 53.8] |
| ai-ai | 第二件伸出／贴着 | lamp-slipper:out-out-e180->out-hug-e180 | 30/100 | 48/100 | 18 [6.1, 29.9] | 40% [30.9, 49.8] |
| ai-ai | 第二件伸出／贴着 | lamp-slipper:out-out-e90->out-hug-e90 | 39/100 | 35/100 | -4 [-17.6, 9.6] | 48% [38.5, 57.7] |
| ai-ai | 第二件伸出／贴着 | lamp-slipper:hug-out-e180->hug-hug-e180 | 26/100 | 31/100 | 5 [-7.6, 17.6] | 41% [31.9, 50.8] |
| ai-ai | 第二件伸出／贴着 | lamp-slipper:hug-out-e90->hug-hug-e90 | 25/100 | 39/100 | 14 [1.9, 26.1] | 40% [30.9, 49.8] |
| ai-ai | 两件挨着／对面 | lamp-slipper:out-out-e180->out-out-e90 | 30/100 | 39/100 | 9 [-2.9, 20.9] | 37% [28.2, 46.8] |
| ai-ai | 两件挨着／对面 | lamp-slipper:out-hug-e180->out-hug-e90 | 48/100 | 35/100 | -13 [-26.3, 0.3] | 47% [37.5, 56.7] |
| ai-ai | 两件挨着／对面 | lamp-slipper:hug-out-e180->hug-out-e90 | 26/100 | 25/100 | -1 [-12.7, 10.7] | 35% [26.4, 44.7] |
| ai-ai | 两件挨着／对面 | lamp-slipper:hug-hug-e180->hug-hug-e90 | 31/100 | 39/100 | 8 [-5.3, 21.3] | 46% [36.6, 55.7] |
| ai-ai | 带哪两件 | out-out-e180:pan-broom->scissors-pillow | 49/100 | 24/100 | -25 [-37.3, -12.7] | 45% [35.6, 54.8] |
| ai-ai | 带哪两件 | out-out-e180:pan-broom->lamp-slipper | 49/100 | 30/100 | -19 [-32.3, -5.7] | 49% [39.4, 58.7] |
| ai-ai | 带哪两件 | out-out-e180:scissors-pillow->lamp-slipper | 24/100 | 30/100 | 6 [-5.4, 17.4] | 34% [25.5, 43.7] |
| ai-ai | 带哪两件 | out-out-e90:pan-broom->scissors-pillow | 68/100 | 20/100 | -48 [-60.9, -35.1] | 66% [56.3, 74.5] |
| ai-ai | 带哪两件 | out-out-e90:pan-broom->lamp-slipper | 68/100 | 39/100 | -29 [-41.6, -16.4] | 49% [39.4, 58.7] |
| ai-ai | 带哪两件 | out-out-e90:scissors-pillow->lamp-slipper | 20/100 | 39/100 | 19 [7.3, 30.7] | 39% [30, 48.8] |
| ai-ai | 带哪两件 | out-hug-e180:pan-broom->scissors-pillow | 69/100 | 29/100 | -40 [-51.8, -28.2] | 52% [42.3, 61.5] |
| ai-ai | 带哪两件 | out-hug-e180:pan-broom->lamp-slipper | 69/100 | 48/100 | -21 [-33.2, -8.8] | 43% [33.7, 52.8] |
| ai-ai | 带哪两件 | out-hug-e180:scissors-pillow->lamp-slipper | 29/100 | 48/100 | 19 [6, 32] | 47% [37.5, 56.7] |
| ai-ai | 带哪两件 | out-hug-e90:pan-broom->scissors-pillow | 49/100 | 22/100 | -27 [-40.9, -13.1] | 57% [47.2, 66.3] |
| ai-ai | 带哪两件 | out-hug-e90:pan-broom->lamp-slipper | 49/100 | 35/100 | -14 [-28.5, 0.5] | 56% [46.2, 65.3] |
| ai-ai | 带哪两件 | out-hug-e90:scissors-pillow->lamp-slipper | 22/100 | 35/100 | 13 [0.3, 25.7] | 43% [33.7, 52.8] |
| ai-ai | 带哪两件 | hug-out-e180:pan-broom->scissors-pillow | 56/100 | 26/100 | -30 [-42.9, -17.1] | 52% [42.3, 61.5] |
| ai-ai | 带哪两件 | hug-out-e180:pan-broom->lamp-slipper | 56/100 | 26/100 | -30 [-43.5, -16.5] | 56% [46.2, 65.3] |
| ai-ai | 带哪两件 | hug-out-e180:scissors-pillow->lamp-slipper | 26/100 | 26/100 | 0 [-12.8, 12.8] | 42% [32.8, 51.8] |
| ai-ai | 带哪两件 | hug-out-e90:pan-broom->scissors-pillow | 46/100 | 23/100 | -23 [-36.6, -9.4] | 53% [43.3, 62.5] |
| ai-ai | 带哪两件 | hug-out-e90:pan-broom->lamp-slipper | 46/100 | 25/100 | -21 [-33.9, -8.1] | 47% [37.5, 56.7] |
| ai-ai | 带哪两件 | hug-out-e90:scissors-pillow->lamp-slipper | 23/100 | 25/100 | 2 [-9.5, 13.5] | 34% [25.5, 43.7] |
| ai-ai | 带哪两件 | hug-hug-e180:pan-broom->scissors-pillow | 40/100 | 34/100 | -6 [-18.1, 6.1] | 38% [29.1, 47.8] |
| ai-ai | 带哪两件 | hug-hug-e180:pan-broom->lamp-slipper | 40/100 | 31/100 | -9 [-23, 5] | 51% [41.3, 60.6] |
| ai-ai | 带哪两件 | hug-hug-e180:scissors-pillow->lamp-slipper | 34/100 | 31/100 | -3 [-16.8, 10.8] | 49% [39.4, 58.7] |
| ai-ai | 带哪两件 | hug-hug-e90:pan-broom->scissors-pillow | 44/100 | 24/100 | -20 [-33.1, -6.9] | 48% [38.5, 57.7] |
| ai-ai | 带哪两件 | hug-hug-e90:pan-broom->lamp-slipper | 44/100 | 39/100 | -5 [-17.9, 7.9] | 43% [33.7, 52.8] |
| ai-ai | 带哪两件 | hug-hug-e90:scissors-pillow->lamp-slipper | 24/100 | 39/100 | 15 [1.2, 28.8] | 51% [41.3, 60.6] |
| auto | 第一件伸出／贴着 | pan-broom:out-out-e180->hug-out-e180 | 46/100 | 55/100 | 9 [-4.7, 22.7] | 49% [39.4, 58.7] |
| auto | 第一件伸出／贴着 | pan-broom:out-out-e90->hug-out-e90 | 68/100 | 53/100 | -15 [-27.9, -2.1] | 45% [35.6, 54.8] |
| auto | 第一件伸出／贴着 | pan-broom:out-hug-e180->hug-hug-e180 | 52/100 | 57/100 | 5 [-9.3, 19.3] | 53% [43.3, 62.5] |
| auto | 第一件伸出／贴着 | pan-broom:out-hug-e90->hug-hug-e90 | 66/100 | 35/100 | -31 [-45.1, -16.9] | 61% [51.2, 70] |
| auto | 第二件伸出／贴着 | pan-broom:out-out-e180->out-hug-e180 | 46/100 | 52/100 | 6 [-8.7, 20.7] | 56% [46.2, 65.3] |
| auto | 第二件伸出／贴着 | pan-broom:out-out-e90->out-hug-e90 | 68/100 | 66/100 | -2 [-15.6, 11.6] | 48% [38.5, 57.7] |
| auto | 第二件伸出／贴着 | pan-broom:hug-out-e180->hug-hug-e180 | 55/100 | 57/100 | 2 [-11.4, 15.4] | 46% [36.6, 55.7] |
| auto | 第二件伸出／贴着 | pan-broom:hug-out-e90->hug-hug-e90 | 53/100 | 35/100 | -18 [-32, -4] | 54% [44.3, 63.4] |
| auto | 两件挨着／对面 | pan-broom:out-out-e180->out-out-e90 | 46/100 | 68/100 | 22 [8.5, 35.5] | 52% [42.3, 61.5] |
| auto | 两件挨着／对面 | pan-broom:out-hug-e180->out-hug-e90 | 52/100 | 66/100 | 14 [0.6, 27.4] | 48% [38.5, 57.7] |
| auto | 两件挨着／对面 | pan-broom:hug-out-e180->hug-out-e90 | 55/100 | 53/100 | -2 [-14.8, 10.8] | 42% [32.8, 51.8] |
| auto | 两件挨着／对面 | pan-broom:hug-hug-e180->hug-hug-e90 | 57/100 | 35/100 | -22 [-34.6, -9.4] | 46% [36.6, 55.7] |
| auto | 第一件伸出／贴着 | scissors-pillow:out-out-e180->hug-out-e180 | 52/100 | 54/100 | 2 [-11.9, 15.9] | 50% [40.4, 59.6] |
| auto | 第一件伸出／贴着 | scissors-pillow:out-out-e90->hug-out-e90 | 43/100 | 41/100 | -2 [-15.1, 11.1] | 44% [34.7, 53.8] |
| auto | 第一件伸出／贴着 | scissors-pillow:out-hug-e180->hug-hug-e180 | 55/100 | 52/100 | -3 [-17.1, 11.1] | 51% [41.3, 60.6] |
| auto | 第一件伸出／贴着 | scissors-pillow:out-hug-e90->hug-hug-e90 | 24/100 | 38/100 | 14 [0.1, 27.9] | 52% [42.3, 61.5] |
| auto | 第二件伸出／贴着 | scissors-pillow:out-out-e180->out-hug-e180 | 52/100 | 55/100 | 3 [-10.2, 16.2] | 45% [35.6, 54.8] |
| auto | 第二件伸出／贴着 | scissors-pillow:out-out-e90->out-hug-e90 | 43/100 | 24/100 | -19 [-30.7, -7.3] | 39% [30, 48.8] |
| auto | 第二件伸出／贴着 | scissors-pillow:hug-out-e180->hug-hug-e180 | 54/100 | 52/100 | -2 [-16.5, 12.5] | 54% [44.3, 63.4] |
| auto | 第二件伸出／贴着 | scissors-pillow:hug-out-e90->hug-hug-e90 | 41/100 | 38/100 | -3 [-16.5, 10.5] | 47% [37.5, 56.7] |
| auto | 两件挨着／对面 | scissors-pillow:out-out-e180->out-out-e90 | 52/100 | 43/100 | -9 [-22.7, 4.7] | 49% [39.4, 58.7] |
| auto | 两件挨着／对面 | scissors-pillow:out-hug-e180->out-hug-e90 | 55/100 | 24/100 | -31 [-43.7, -18.3] | 51% [41.3, 60.6] |
| auto | 两件挨着／对面 | scissors-pillow:hug-out-e180->hug-out-e90 | 54/100 | 41/100 | -13 [-27.7, 1.7] | 57% [47.2, 66.3] |
| auto | 两件挨着／对面 | scissors-pillow:hug-hug-e180->hug-hug-e90 | 52/100 | 38/100 | -14 [-27.4, -0.6] | 48% [38.5, 57.7] |
| auto | 第一件伸出／贴着 | lamp-slipper:out-out-e180->hug-out-e180 | 38/100 | 39/100 | 1 [-12.8, 14.8] | 49% [39.4, 58.7] |
| auto | 第一件伸出／贴着 | lamp-slipper:out-out-e90->hug-out-e90 | 46/100 | 40/100 | -6 [-19.3, 7.3] | 46% [36.6, 55.7] |
| auto | 第一件伸出／贴着 | lamp-slipper:out-hug-e180->hug-hug-e180 | 42/100 | 46/100 | 4 [-9.9, 17.9] | 50% [40.4, 59.6] |
| auto | 第一件伸出／贴着 | lamp-slipper:out-hug-e90->hug-hug-e90 | 59/100 | 54/100 | -5 [-18.5, 8.5] | 47% [37.5, 56.7] |
| auto | 第二件伸出／贴着 | lamp-slipper:out-out-e180->out-hug-e180 | 38/100 | 42/100 | 4 [-9.3, 17.3] | 46% [36.6, 55.7] |
| auto | 第二件伸出／贴着 | lamp-slipper:out-out-e90->out-hug-e90 | 46/100 | 59/100 | 13 [-0.8, 26.8] | 51% [41.3, 60.6] |
| auto | 第二件伸出／贴着 | lamp-slipper:hug-out-e180->hug-hug-e180 | 39/100 | 46/100 | 7 [-6.4, 20.4] | 47% [37.5, 56.7] |
| auto | 第二件伸出／贴着 | lamp-slipper:hug-out-e90->hug-hug-e90 | 40/100 | 54/100 | 14 [0.6, 27.4] | 48% [38.5, 57.7] |
| auto | 两件挨着／对面 | lamp-slipper:out-out-e180->out-out-e90 | 38/100 | 46/100 | 8 [-5.6, 21.6] | 48% [38.5, 57.7] |
| auto | 两件挨着／对面 | lamp-slipper:out-hug-e180->out-hug-e90 | 42/100 | 59/100 | 17 [2, 32] | 61% [51.2, 70] |
| auto | 两件挨着／对面 | lamp-slipper:hug-out-e180->hug-out-e90 | 39/100 | 40/100 | 1 [-12.8, 14.8] | 49% [39.4, 58.7] |
| auto | 两件挨着／对面 | lamp-slipper:hug-hug-e180->hug-hug-e90 | 46/100 | 54/100 | 8 [-5.3, 21.3] | 46% [36.6, 55.7] |
| auto | 带哪两件 | out-out-e180:pan-broom->scissors-pillow | 46/100 | 52/100 | 6 [-7, 19] | 44% [34.7, 53.8] |
| auto | 带哪两件 | out-out-e180:pan-broom->lamp-slipper | 46/100 | 38/100 | -8 [-21, 5] | 44% [34.7, 53.8] |
| auto | 带哪两件 | out-out-e180:scissors-pillow->lamp-slipper | 52/100 | 38/100 | -14 [-27.7, -0.3] | 50% [40.4, 59.6] |
| auto | 带哪两件 | out-out-e90:pan-broom->scissors-pillow | 68/100 | 43/100 | -25 [-37.9, -12.1] | 49% [39.4, 58.7] |
| auto | 带哪两件 | out-out-e90:pan-broom->lamp-slipper | 68/100 | 46/100 | -22 [-35.2, -8.8] | 50% [40.4, 59.6] |
| auto | 带哪两件 | out-out-e90:scissors-pillow->lamp-slipper | 43/100 | 46/100 | 3 [-11.1, 17.1] | 51% [41.3, 60.6] |
| auto | 带哪两件 | out-hug-e180:pan-broom->scissors-pillow | 52/100 | 55/100 | 3 [-10.2, 16.2] | 45% [35.6, 54.8] |
| auto | 带哪两件 | out-hug-e180:pan-broom->lamp-slipper | 52/100 | 42/100 | -10 [-23.8, 3.8] | 50% [40.4, 59.6] |
| auto | 带哪两件 | out-hug-e180:scissors-pillow->lamp-slipper | 55/100 | 42/100 | -13 [-26.5, 0.5] | 49% [39.4, 58.7] |
| auto | 带哪两件 | out-hug-e90:pan-broom->scissors-pillow | 66/100 | 24/100 | -42 [-54.5, -29.5] | 58% [48.2, 67.2] |
| auto | 带哪两件 | out-hug-e90:pan-broom->lamp-slipper | 66/100 | 59/100 | -7 [-20.7, 6.7] | 49% [39.4, 58.7] |
| auto | 带哪两件 | out-hug-e90:scissors-pillow->lamp-slipper | 24/100 | 59/100 | 35 [22.1, 47.9] | 55% [45.2, 64.4] |
| auto | 带哪两件 | hug-out-e180:pan-broom->scissors-pillow | 55/100 | 54/100 | -1 [-14.5, 12.5] | 47% [37.5, 56.7] |
| auto | 带哪两件 | hug-out-e180:pan-broom->lamp-slipper | 55/100 | 39/100 | -16 [-29.3, -2.7] | 48% [38.5, 57.7] |
| auto | 带哪两件 | hug-out-e180:scissors-pillow->lamp-slipper | 54/100 | 39/100 | -15 [-29.6, -0.4] | 57% [47.2, 66.3] |
| auto | 带哪两件 | hug-out-e90:pan-broom->scissors-pillow | 53/100 | 41/100 | -12 [-25.7, 1.7] | 50% [40.4, 59.6] |
| auto | 带哪两件 | hug-out-e90:pan-broom->lamp-slipper | 53/100 | 40/100 | -13 [-26.3, 0.3] | 47% [37.5, 56.7] |
| auto | 带哪两件 | hug-out-e90:scissors-pillow->lamp-slipper | 41/100 | 40/100 | -1 [-14.5, 12.5] | 47% [37.5, 56.7] |
| auto | 带哪两件 | hug-hug-e180:pan-broom->scissors-pillow | 57/100 | 52/100 | -5 [-18.8, 8.8] | 49% [39.4, 58.7] |
| auto | 带哪两件 | hug-hug-e180:pan-broom->lamp-slipper | 57/100 | 46/100 | -11 [-25.7, 3.7] | 57% [47.2, 66.3] |
| auto | 带哪两件 | hug-hug-e180:scissors-pillow->lamp-slipper | 52/100 | 46/100 | -6 [-19.3, 7.3] | 46% [36.6, 55.7] |
| auto | 带哪两件 | hug-hug-e90:pan-broom->scissors-pillow | 35/100 | 38/100 | 3 [-9.9, 15.9] | 43% [33.7, 52.8] |
| auto | 带哪两件 | hug-hug-e90:pan-broom->lamp-slipper | 35/100 | 54/100 | 19 [5.7, 32.3] | 49% [39.4, 58.7] |
| auto | 带哪两件 | hug-hug-e90:scissors-pillow->lamp-slipper | 38/100 | 54/100 | 16 [1.1, 30.9] | 60% [50.2, 69.1] |
| ai-ai | AI改为不按 | pan-broom/out-out-e180 | 49/100 | 18/100 | -31 [-43.7, -18.3] | 51% [41.3, 60.6] |
| ai-ai | AI改为不按 | pan-broom/hug-hug-e90 | 44/100 | 6/100 | -38 [-48.3, -27.7] | 42% [32.8, 51.8] |
| ai-ai | AI改为不按 | scissors-pillow/out-out-e180 | 24/100 | 2/100 | -22 [-30.6, -13.4] | 24% [16.7, 33.2] |
| ai-ai | AI改为不按 | scissors-pillow/hug-hug-e90 | 24/100 | 0/100 | -24 [-32.4, -15.6] | 24% [16.7, 33.2] |
| ai-ai | AI改为不按 | lamp-slipper/out-out-e180 | 30/100 | 4/100 | -26 [-35.9, -16.1] | 32% [23.7, 41.7] |
| ai-ai | AI改为不按 | lamp-slipper/hug-hug-e90 | 39/100 | 7/100 | -32 [-42.4, -21.6] | 38% [29.1, 47.8] |
| ai-ai | AI改为固定乱按 | pan-broom/out-out-e180 | 49/100 | 51/100 | 2 [-11.4, 15.4] | 46% [36.6, 55.7] |
| ai-ai | AI改为固定乱按 | pan-broom/hug-hug-e90 | 44/100 | 41/100 | -3 [-16.2, 10.2] | 45% [35.6, 54.8] |
| ai-ai | AI改为固定乱按 | scissors-pillow/out-out-e180 | 24/100 | 28/100 | 4 [-8.7, 16.7] | 42% [32.8, 51.8] |
| ai-ai | AI改为固定乱按 | scissors-pillow/hug-hug-e90 | 24/100 | 17/100 | -7 [-19.2, 5.2] | 39% [30, 48.8] |
| ai-ai | AI改为固定乱按 | lamp-slipper/out-out-e180 | 30/100 | 34/100 | 4 [-8.1, 16.1] | 38% [29.1, 47.8] |
| ai-ai | AI改为固定乱按 | lamp-slipper/hug-hug-e90 | 39/100 | 40/100 | 1 [-12.2, 14.2] | 45% [35.6, 54.8] |
| ai-ai | 只换开局随机数 | pan-broom/out-out-e180 | 49/100 | 44/100 | -5 [-19.6, 9.6] | 55% [45.2, 64.4] |
| ai-ai | 只换开局随机数 | pan-broom/hug-hug-e90 | 44/100 | 29/100 | -15 [-27.9, -2.1] | 45% [35.6, 54.8] |
| ai-ai | 只换开局随机数 | scissors-pillow/out-out-e180 | 24/100 | 25/100 | 1 [-11, 13] | 37% [28.2, 46.8] |
| ai-ai | 只换开局随机数 | scissors-pillow/hug-hug-e90 | 24/100 | 24/100 | 0 [-12.1, 12.1] | 38% [29.1, 47.8] |
| ai-ai | 只换开局随机数 | lamp-slipper/out-out-e180 | 30/100 | 33/100 | 3 [-9.3, 15.3] | 39% [30, 48.8] |
| ai-ai | 只换开局随机数 | lamp-slipper/hug-hug-e90 | 39/100 | 36/100 | -3 [-15.3, 9.3] | 39% [30, 48.8] |
| ai-ai | 只换暴击随机数 | pan-broom/out-out-e180 | 49/100 | 50/100 | 1 [-2.4, 4.4] | 3% [1, 8.5] |
| ai-ai | 只换暴击随机数 | pan-broom/hug-hug-e90 | 44/100 | 42/100 | -2 [-8.8, 4.8] | 12% [7, 19.8] |
| ai-ai | 只换暴击随机数 | scissors-pillow/out-out-e180 | 24/100 | 23/100 | -1 [-4.4, 2.4] | 3% [1, 8.5] |
| ai-ai | 只换暴击随机数 | scissors-pillow/hug-hug-e90 | 24/100 | 26/100 | 2 [-1.9, 5.9] | 4% [1.6, 9.8] |
| ai-ai | 只换暴击随机数 | lamp-slipper/out-out-e180 | 30/100 | 31/100 | 1 [-4.2, 6.2] | 7% [3.4, 13.7] |
| ai-ai | 只换暴击随机数 | lamp-slipper/hug-hug-e90 | 39/100 | 39/100 | 0 [-2.8, 2.8] | 2% [0.6, 7] |
| ai-ai | 只换电脑决策随机数 | pan-broom/out-out-e180 | 49/100 | 39/100 | -10 [-23.8, 3.8] | 50% [40.4, 59.6] |
| ai-ai | 只换电脑决策随机数 | pan-broom/hug-hug-e90 | 44/100 | 24/100 | -20 [-33.1, -6.9] | 48% [38.5, 57.7] |
| ai-ai | 只换电脑决策随机数 | scissors-pillow/out-out-e180 | 24/100 | 25/100 | 1 [-11, 13] | 37% [28.2, 46.8] |
| ai-ai | 只换电脑决策随机数 | scissors-pillow/hug-hug-e90 | 24/100 | 20/100 | -4 [-14.8, 6.8] | 30% [21.9, 39.6] |
| ai-ai | 只换电脑决策随机数 | lamp-slipper/out-out-e180 | 30/100 | 29/100 | -1 [-13.3, 11.3] | 39% [30, 48.8] |
| ai-ai | 只换电脑决策随机数 | lamp-slipper/hug-hug-e90 | 39/100 | 30/100 | -9 [-22.7, 4.7] | 49% [39.4, 58.7] |
| ai-ai | 只把右方转180° | pan-broom/out-out-e180 | 49/100 | 40/100 | -9 [-23, 5] | 51% [41.3, 60.6] |
| ai-ai | 只把右方转180° | pan-broom/hug-hug-e90 | 44/100 | 34/100 | -10 [-22.6, 2.6] | 42% [32.8, 51.8] |
| ai-ai | 只把右方转180° | scissors-pillow/out-out-e180 | 24/100 | 23/100 | -1 [-12.7, 10.7] | 35% [26.4, 44.7] |
| ai-ai | 只把右方转180° | scissors-pillow/hug-hug-e90 | 24/100 | 22/100 | -2 [-13.8, 9.8] | 36% [27.3, 45.8] |
| ai-ai | 只把右方转180° | lamp-slipper/out-out-e180 | 30/100 | 36/100 | 6 [-7, 19] | 44% [34.7, 53.8] |
| ai-ai | 只把右方转180° | lamp-slipper/hug-hug-e90 | 39/100 | 44/100 | 5 [-8.5, 18.5] | 47% [37.5, 56.7] |
| ai-ai | 不按改为固定乱按 | pan-broom/out-out-e180 | 18/100 | 51/100 | 33 [20.8, 45.2] | 49% [39.4, 58.7] |
| ai-ai | 不按改为固定乱按 | pan-broom/hug-hug-e90 | 6/100 | 41/100 | 35 [24.8, 45.2] | 39% [30, 48.8] |
| ai-ai | 不按改为固定乱按 | scissors-pillow/out-out-e180 | 2/100 | 28/100 | 26 [16.5, 35.5] | 30% [21.9, 39.6] |
| ai-ai | 不按改为固定乱按 | scissors-pillow/hug-hug-e90 | 0/100 | 17/100 | 17 [9.6, 24.4] | 17% [10.9, 25.5] |
| ai-ai | 不按改为固定乱按 | lamp-slipper/out-out-e180 | 4/100 | 34/100 | 30 [19.8, 40.2] | 36% [27.3, 45.8] |
| ai-ai | 不按改为固定乱按 | lamp-slipper/hug-hug-e90 | 7/100 | 40/100 | 33 [22.6, 43.4] | 39% [30, 48.8] |

## 新条件的操作和弱点原始计数

| 条件 | 场景 | 胜/负/平 | 有暴击抽签的局 | 抽签次数 | 暴击次数 | 玩家冲/挡总数 |
|---|---|---|---:|---:|---:|---:|
| idle | pan-broom/out-out-e180 | 18/82/0 | 68 | 103 | 49 | 0/0 |
| idle | pan-broom/hug-hug-e90 | 6/94/0 | 86 | 161 | 82 | 0/0 |
| idle | scissors-pillow/out-out-e180 | 2/98/0 | 53 | 75 | 44 | 0/0 |
| idle | scissors-pillow/hug-hug-e90 | 0/100/0 | 52 | 71 | 35 | 0/0 |
| idle | lamp-slipper/out-out-e180 | 4/96/0 | 63 | 102 | 54 | 0/0 |
| idle | lamp-slipper/hug-hug-e90 | 7/93/0 | 53 | 80 | 43 | 0/0 |
| mash | pan-broom/out-out-e180 | 51/49/0 | 62 | 90 | 48 | 641/532 |
| mash | pan-broom/hug-hug-e90 | 41/59/0 | 91 | 194 | 101 | 659/552 |
| mash | scissors-pillow/out-out-e180 | 28/72/0 | 72 | 116 | 60 | 649/543 |
| mash | scissors-pillow/hug-hug-e90 | 17/83/0 | 76 | 137 | 72 | 601/500 |
| mash | lamp-slipper/out-out-e180 | 34/66/0 | 73 | 129 | 60 | 622/521 |
| mash | lamp-slipper/hug-hug-e90 | 40/60/0 | 65 | 106 | 58 | 636/527 |
| initial | pan-broom/out-out-e180 | 44/56/0 | 72 | 111 | 58 | 595/252 |
| initial | pan-broom/hug-hug-e90 | 29/71/0 | 89 | 188 | 99 | 615/267 |
| initial | scissors-pillow/out-out-e180 | 25/75/0 | 69 | 108 | 52 | 584/252 |
| initial | scissors-pillow/hug-hug-e90 | 24/76/0 | 70 | 118 | 64 | 542/234 |
| initial | lamp-slipper/out-out-e180 | 33/67/0 | 78 | 137 | 77 | 551/262 |
| initial | lamp-slipper/hug-hug-e90 | 36/64/0 | 65 | 100 | 51 | 559/253 |
| critical | pan-broom/out-out-e180 | 50/50/0 | 78 | 121 | 60 | 588/259 |
| critical | pan-broom/hug-hug-e90 | 42/58/0 | 89 | 187 | 92 | 610/266 |
| critical | scissors-pillow/out-out-e180 | 23/77/0 | 63 | 90 | 46 | 583/256 |
| critical | scissors-pillow/hug-hug-e90 | 26/74/0 | 68 | 107 | 50 | 549/239 |
| critical | lamp-slipper/out-out-e180 | 31/69/0 | 74 | 125 | 63 | 557/247 |
| critical | lamp-slipper/hug-hug-e90 | 39/61/0 | 65 | 107 | 53 | 577/258 |
| ai-random | pan-broom/out-out-e180 | 39/61/0 | 73 | 128 | 75 | 564/249 |
| ai-random | pan-broom/hug-hug-e90 | 24/76/0 | 90 | 201 | 100 | 600/262 |
| ai-random | scissors-pillow/out-out-e180 | 25/75/0 | 71 | 118 | 59 | 585/255 |
| ai-random | scissors-pillow/hug-hug-e90 | 20/80/0 | 64 | 105 | 54 | 566/252 |
| ai-random | lamp-slipper/out-out-e180 | 29/71/0 | 75 | 128 | 66 | 557/231 |
| ai-random | lamp-slipper/hug-hug-e90 | 30/70/0 | 63 | 105 | 59 | 572/259 |
| right-yaw | pan-broom/out-out-e180 | 40/60/0 | 81 | 144 | 78 | 587/272 |
| right-yaw | pan-broom/hug-hug-e90 | 34/66/0 | 81 | 157 | 87 | 610/258 |
| right-yaw | scissors-pillow/out-out-e180 | 23/77/0 | 72 | 114 | 58 | 575/264 |
| right-yaw | scissors-pillow/hug-hug-e90 | 22/78/0 | 69 | 111 | 61 | 564/261 |
| right-yaw | lamp-slipper/out-out-e180 | 36/64/0 | 78 | 133 | 67 | 566/258 |
| right-yaw | lamp-slipper/hug-hug-e90 | 44/56/0 | 74 | 123 | 71 | 573/247 |

## 因素的代码依据

- 初始姿态与位置：sim/v3.js:62、165–168。随机流与暴击、AI独立。右方180°用q*Ry(π)，不改变世界中心、自身竖轴倾斜或角速度；只测相对初始朝向，不做左右换边结论。
- 攻守与冲挡：sim/v3.js:178–198、235–248。单方冲命中直接成攻方；档位伤害见95–101；弱点抽签245；伤害倍率248。模式A用冲量，模式B用攻防数值，本轮只测A。
- 部件血量/质量/掉件：sim/v3.js:68–85；追撞与转速驱动204–218；时间加伤函数106、参数top.damageRamp。
- 判胜：sim/v3.js:269–290，同帧双KO比较超额伤害，60秒仍活着为平局；没有按剩余血比例判赢。
- 真实参数：sim/v3-rules.json（counterSpeedMultiplier=2、roleMassPower=.25、itemPower/itemHp、manual各字段）；物品材质/粗外形/弱点来自data/catalog.json。

## 解释边界
组间方向不是普遍加成；装备一换同时换了若干属性，不能据本表拆“外形占几成、重量占几成”。单个随机流重抽后的净胜率近零只是没有稳定偏袒，单局翻转另列。换随机流之后反馈会改变后续碰撞和抽签次数，是该干预的总效应。AI策略弱，不等于真人上限；本轮不改平衡或玩法。
