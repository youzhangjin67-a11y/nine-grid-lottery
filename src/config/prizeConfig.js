/**
 * 奖品池默认配置（纯图片版：无 emoji、无空奖，每次抽奖必中物品）
 *
 * 九宫格每轮只显示 8 个奖品，开始抽奖时会从下面的奖池中
 * 随机采样 8 个上格子（按权重抽样、不重复），所以每轮阵容都不一样。
 *
 * 字段说明：
 * - weight：权重。既影响"被抽上格子"的概率，也影响"最终中奖"的概率
 *   （当前默认全部为 1，即所有奖品等概率；如需差异化中奖率，调整对应数值即可）
 * - image： 奖品图片，取自 src/assets/img/wupin/1.png ~ 20.png，
 *           与下面 20 个奖品按编号一一对应；想换对应关系改 wupin(n) 即可。
 *
 * 页面上可以增删奖品、改名称/图片/权重；「恢复默认」即还原为本文件内容。
 */

// 批量引入 wupin 目录下的默认物品图片
const wupinImages = import.meta.glob('../assets/img/wupin/*.png', {
  eager: true,
  import: 'default',
})
/** 取 wupin 目录下编号 n 的图片地址 */
const wupin = (n) => wupinImages[`../assets/img/wupin/${n}.png`]

export const defaultPrizePool = [
  { id: 101, name: 'iPhone', weight: 1, image: wupin(1) },
  { id: 102, name: '笔记本电脑', weight: 1, image: wupin(2) },
  { id: 103, name: '无线耳机', weight: 1, image: wupin(3) },
  { id: 104, name: '智能手表', weight: 1, image: wupin(4) },
  { id: 105, name: '红包 ¥8.88', weight: 1, image: wupin(5) },
  { id: 106, name: '优惠券 ¥50', weight: 1, image: wupin(6) },
  { id: 107, name: '积分 +100', weight: 1, image: wupin(7) },
  { id: 108, name: '再抽一次', weight: 1, image: wupin(8) },
  { id: 109, name: '幸运盲盒', weight: 1, image: wupin(9) },
  { id: 110, name: '奶茶一杯', weight: 1, image: wupin(10) },
  { id: 111, name: '咖啡券', weight: 1, image: wupin(11) },
  { id: 112, name: '零食大礼包', weight: 1, image: wupin(12) },
  { id: 113, name: '电影票两张', weight: 1, image: wupin(13) },
  { id: 114, name: '毛绒玩偶', weight: 1, image: wupin(14) },
  { id: 115, name: '终极大奖', weight: 1, image: wupin(15) },
  { id: 116, name: '幸运金币', weight: 1, image: wupin(16) },
  { id: 117, name: '口红', weight: 1, image: wupin(17) },
  { id: 118, name: '潮流球鞋', weight: 1, image: wupin(18) },
  { id: 119, name: '充电宝', weight: 1, image: wupin(19) },
  { id: 120, name: '闪亮贴纸', weight: 1, image: wupin(20) },
]

/** 初始可用抽奖次数（仅一次；页面左上角有隐形重置按钮可恢复） */
export const TOTAL_DRAWS = 1

/** 页面内自定义奖品池在 localStorage 中的存储键（v3：去 emoji / 去空奖后升级） */
export const STORAGE_KEY = 'nine-grid-lottery/custom-prizes-v3'
