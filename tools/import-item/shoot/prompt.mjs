// Identity/geometry constraints survive a later change of visual style.
export const photoStyle = '废土朋克游戏道具；少量工业黄漆、警示纹、划痕和旧布';
export function photoPrompt(name, style = photoStyle) {
  return `只保留参考照片中识别出的${name}，只要物件本身。去掉照片里的其他物品、桌面和背景。只出一张单视图，不做多视图或前后对比，不复制主体。原照只有一件，输出也只能是一件；只有原照本来是一双或一对时，才保留原有成对结构，当作一个完整道具。保留主体原有轮廓、比例、主要结构和材质特征，不替换成标准样本。不要添加底座、展台、比例尺、地板、人体；不增加原照没有的尖刺或夸大结构。已有花盆属于物件，保留原花盆，不在盆下增加任何板、台或托架。保持物件直立方向。风格：${style}。背景仅为纯浅灰，均匀柔光；背景不属于模型，不要建出任何背景或承托地面。`;
}
