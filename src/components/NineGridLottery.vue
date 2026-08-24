<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { defaultPrizePool, TOTAL_DRAWS, STORAGE_KEY } from '../config/prizeConfig'
import fallbackImg from '../assets/img/wupin/9.png' // 缺省占位图（盲盒）

/* ---------------- 常量：格子布局与滚动路径 ---------------- */

// 九宫格行优先下标布局：
//   0 1 2
//   3 4(按钮) 5
//   6 7 8
const BUTTON_CELL = 4

// 顺时针滚动路径（row-major 下标）
const PATH = [0, 1, 2, 5, 8, 7, 6, 3]
const CELL_COUNT = PATH.length // 8
const SLOT_COUNT = CELL_COUNT // 每轮上格子的奖品数量

// 滚动节奏参数
const FAST_MS = 70 // 匀速阶段每步间隔
const START_MS = 180 // 起步第一步间隔
const RAMP_UP_STEPS = 4 // 起步加速步数
const SLOW_DOWN_CELLS = CELL_COUNT * 2 // 最后两圈开始减速
const MAX_SLOW_MS = 420 // 减速末端的最大间隔
const MIN_LOOPS = 4 // 至少完整转几圈再停

// 自定义图片压缩参数（格子与预览都很小，压到 160px 足够清晰且省空间）
const IMAGE_MAX_SIZE = 160
const MIN_POOL_SIZE = 8 // 奖池最少保留数量，保证九宫格能填满

// 常驻闪变参数：闲置时所有格子每隔一段时间各自随机换奖品，营造华丽效果
const SHIMMER_INTERVAL = 220
// 开奖后定格展示多久，再恢复常驻闪变
const RESULT_SETTLE_MS = 1400

/* ---------------- 奖池数据：加载 / 持久化 ---------------- */

function cloneDefaults() {
  return defaultPrizePool.map((p) => ({ ...p }))
}

/** 兜底清洗单条奖品数据 */
function normalizePrize(raw, fallbackId) {
  const weight = Number(raw?.weight)
  return {
    id: typeof raw?.id === 'number' ? raw.id : fallbackId,
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name : '神秘奖品',
    image: typeof raw?.image === 'string' ? raw.image : '',
    weight: Number.isFinite(weight) && weight >= 1 ? Math.min(999, Math.round(weight)) : 10,
  }
}

/** 从 localStorage 恢复自定义奖池；不足 8 个时用默认奖品补齐 */
function loadPool() {
  let saved = null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length >= MIN_POOL_SIZE) saved = parsed
    }
  } catch {
    /* 数据损坏则回退默认 */
  }
  if (!saved) return cloneDefaults()
  const pool = saved.map((item, i) => normalizePrize(item, Date.now() + i))
  for (let i = 0; pool.length < MIN_POOL_SIZE; i++) {
    pool.push({ ...defaultPrizePool[i % defaultPrizePool.length] })
  }
  return pool
}

const prizePool = ref(loadPool())

const editorError = ref('')

/** 权重兜底：输入非法时按 1 处理 */
function weightOf(p) {
  const w = Number(p.weight)
  return Number.isFinite(w) && w >= 1 ? w : 1
}

/** 整池持久化 + 修复格子上已失效的奖品引用 */
watch(
  prizePool,
  () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prizePool.value))
      editorError.value = ''
    } catch {
      editorError.value = '保存失败：浏览器存储空间不足，请尝试更小的图片'
    }
    // 清理格子采样中已被删除的奖品
    const valid = new Set(prizePool.value.map((p) => p.id))
    slotIds.value = slotIds.value.map((id) =>
      valid.has(id) ? id : prizePool.value[Math.floor(Math.random() * prizePool.value.length)].id,
    )
  },
  { deep: true },
)

const prizeById = computed(() => {
  const map = {}
  prizePool.value.forEach((p) => (map[p.id] = p))
  return map
})

/* ---------------- 抽样与加权随机 ---------------- */

/** 在 items 中按权重随机挑一个，返回下标 */
function weightedIndexOf(items) {
  const total = items.reduce((sum, p) => sum + weightOf(p), 0)
  let r = Math.random() * total
  for (let i = 0; i < items.length; i++) {
    r -= weightOf(items[i])
    if (r < 0) return i
  }
  return items.length - 1
}

/** 从奖池按权重不重复采样 8 个奖品，作为本轮的九宫格阵容 */
function sampleRoundItems() {
  const bag = [...prizePool.value]
  const picked = []
  while (picked.length < SLOT_COUNT && bag.length > 0) {
    picked.push(...bag.splice(weightedIndexOf(bag), 1))
  }
  return picked
}

function randomPoolItem() {
  return prizePool.value[Math.floor(Math.random() * prizePool.value.length)]
}

/* ---------------- 九宫格显示状态 ---------------- */

/*
 * 格子与"槽位"的映射：
 * 槽位 k 按顺时针顺序排列（恰为滚动路径 PATH 的顺序），startRoll 的
 * 停格计算直接使用槽位下标；渲染时用 cellToSlot 把格子号换算回槽位，
 * 保证"指针停在哪个格子，那个格子就是抽中的奖品"。
 */
const SLOT_CELLS = PATH // 槽位 k 对应的格子下标（自文档化别名）
function cellToSlot(cell) {
  return PATH.indexOf(cell)
}

// 本轮上格子的奖品 id（下标即槽位，按顺时针方向排列）
const slotIds = ref(sampleRoundItems().map((p) => p.id))

// 滚动时的"闪变"覆盖：{ 格子下标: 临时展示的奖品 id }，只作用于当前高亮格
const flickerIds = ref({})

// 闲置时的"常驻闪变"覆盖：所有格子轮流随机换奖品，让页面一直华丽闪耀
const shimmerIds = ref({})
let shimmerTimer = null
let settleTimer = null

const FALLBACK_PRIZE = { name: '？？？', image: fallbackImg }

/** 取某个格子当前应显示的奖品：滚动闪变 > 常驻闪变 > 本轮阵容（保证必有图片） */
function cellPrize(cell) {
  const slot = cellToSlot(cell)
  let id
  if (rolling.value) {
    id = flickerIds.value[cell] ?? slotIds.value[slot]
  } else {
    id = shimmerIds.value[cell] ?? slotIds.value[slot]
  }
  const p = prizeById.value[id] || FALLBACK_PRIZE
  return p.image ? p : { ...p, image: fallbackImg }
}

/** 该格子是否为本次中奖的落定格子（开奖时用于揭示名称） */
function isWinnerCell(cell) {
  return !!winner.value && PATH[winner.value.index] === cell
}

/* ---------------- 常驻闪变 ---------------- */

function startShimmer() {
  stopShimmer()
  shimmerTimer = setInterval(() => {
    const map = {}
    for (const c of PATH) {
      map[c] = randomPoolItem().id
    }
    shimmerIds.value = map
  }, SHIMMER_INTERVAL)
}

function stopShimmer() {
  clearInterval(shimmerTimer)
  shimmerTimer = null
}

/* ---------------- 自定义图片上传 ---------------- */

/**
 * 读取用户选择的图片并等比压缩为 dataURL：
 * FileReader 读入 → Image 解码 → canvas 等比缩放 → 导出 WebP（不支持时自动回退 PNG）
 */
function fileToCompressedDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('请选择图片文件'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, IMAGE_MAX_SIZE / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/webp', 0.85))
      }
      img.onerror = () => reject(new Error('图片解码失败，请换一张试试'))
      img.src = reader.result
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

async function onImageChange(e, index) {
  const file = e.target.files?.[0]
  e.target.value = '' // 清空以便可重复选择同一张图
  if (!file) return
  try {
    const dataUrl = await fileToCompressedDataURL(file)
    prizePool.value[index].image = dataUrl
  } catch (err) {
    editorError.value = err.message || '图片处理失败'
  }
}

/* ---------------- 编辑器：增删改 ---------------- */

const editorOpen = ref(false)
const canRemove = computed(() => prizePool.value.length > MIN_POOL_SIZE)

function openEditor() {
  editorError.value = ''
  editorOpen.value = true
}

function closeEditor() {
  editorOpen.value = false
}

function addPrize() {
  prizePool.value.push({
    id: Date.now(),
    name: '新奖品',
    image: '',
    weight: 10,
  })
}

function removePrize(index) {
  if (!canRemove.value) return
  prizePool.value.splice(index, 1)
}

function resetPool() {
  prizePool.value = cloneDefaults()
  editorError.value = ''
}

/* ---------------- 抽奖状态 ---------------- */

const activeCell = ref(-1) // 当前高亮格子的 row-major 下标
const rolling = ref(false)
const remaining = ref(TOTAL_DRAWS === Infinity ? Infinity : TOTAL_DRAWS)
const winner = ref(null) // 中奖结果 { prize, index }
let timer = null

const canDraw = computed(() => !rolling.value && remaining.value > 0 && !winner.value)
const buttonText = computed(() => {
  if (rolling.value) return '抽奖中'
  if (remaining.value <= 0) return '已用完'
  return '开始\n抽奖'
})

/**
 * 计算第 step 步的间隔时长：
 * 起步短暂加速 → 长时间匀速 → 最后两圈二次曲线减速，营造悬念感
 */
function getStepDuration(step, totalSteps) {
  const remain = totalSteps - step
  if (step < RAMP_UP_STEPS) {
    const t = step / RAMP_UP_STEPS
    return Math.round(START_MS - (START_MS - FAST_MS) * t * t)
  }
  if (remain > SLOW_DOWN_CELLS) return FAST_MS
  const t = (SLOW_DOWN_CELLS - remain) / SLOW_DOWN_CELLS // 0 → 1
  return Math.round(FAST_MS + t * t * (MAX_SLOW_MS - FAST_MS))
}

/* ---------------- 核心滚动逻辑 ---------------- */

function startRoll() {
  if (!canDraw.value) return
  // 暂停常驻闪变，锁定本轮阵容
  stopShimmer()
  clearTimeout(settleTimer)
  rolling.value = true
  remaining.value -= 1

  // 第一阶段：从奖池采样本轮阵容并刷新到格子
  const roundItems = sampleRoundItems()
  slotIds.value = roundItems.map((p) => p.id)

  // 第二阶段：在本轮阵容中按权重定下中奖结果，再让指针"演"过去
  const targetIndex = weightedIndexOf(roundItems)
  const currentPathPos = PATH.indexOf(activeCell.value)
  const startPos = currentPathPos === -1 ? CELL_COUNT - 1 : currentPathPos
  const offset = (targetIndex - startPos + CELL_COUNT) % CELL_COUNT
  const totalSteps = MIN_LOOPS * CELL_COUNT + offset

  let step = 0
  const tick = () => {
    step += 1
    activeCell.value = PATH[step % CELL_COUNT]
    if (step >= totalSteps) {
      flickerIds.value = {} // 清除闪变，落定格子显示真实奖品
      rolling.value = false
      winner.value = { prize: roundItems[targetIndex], index: targetIndex }
      // 定格展示片刻，再恢复常驻闪变
      settleTimer = setTimeout(startShimmer, RESULT_SETTLE_MS)
    } else {
      // 高亮格闪变：随机换上池中另一个物品，营造"物品闪烁"效果
      flickerIds.value = { [activeCell.value]: randomPoolItem().id }
      timer = setTimeout(tick, getStepDuration(step, totalSteps))
    }
  }
  timer = setTimeout(tick, getStepDuration(0, totalSteps))
}

function closeResult() {
  winner.value = null
}

/** 重置抽奖次数：恢复初始机会并收起结果弹窗 */
function resetDraws() {
  clearTimeout(settleTimer)
  winner.value = null
  remaining.value = TOTAL_DRAWS === Infinity ? Infinity : TOTAL_DRAWS
}

/* ---------------- 重置抽奖验证（名称 + ID） ---------------- */

// 管理员凭据：只有输入匹配才能重置抽奖次数，可自行修改这两行
const RESET_ADMIN_NAME = 'kirin'
const RESET_ADMIN_ID = '2024'

const resetModalOpen = ref(false)
const resetName = ref('')
const resetId = ref('')
const resetError = ref('')

function openResetModal() {
  resetName.value = ''
  resetId.value = ''
  resetError.value = ''
  resetModalOpen.value = true
}

function closeResetModal() {
  resetModalOpen.value = false
}

/** 校验通过才真正执行重置 */
function confirmReset() {
  const nameOk = resetName.value.trim() === RESET_ADMIN_NAME
  const idOk = resetId.value.trim() === RESET_ADMIN_ID
  if (nameOk && idOk) {
    resetDraws()
    closeResetModal()
  } else {
    resetError.value = nameOk ? 'ID 不正确' : '名称不正确'
  }
}

onMounted(startShimmer)

onBeforeUnmount(() => {
  clearTimeout(timer)
  clearTimeout(settleTimer)
  stopShimmer()
})
</script>

<template>
  <!-- 隐形入口：固定在页面右上角，平时透明，悬停/聚焦时浮现 -->
  <button
    class="secret-edit"
    type="button"
    aria-label="自定义奖品"
    title="自定义奖品"
    @click="openEditor"
  >
    ✏️
  </button>

  <!-- 隐形入口：固定在页面左上角，点击弹出验证弹窗，验证通过才重置抽奖次数 -->
  <button
    class="secret-reset"
    type="button"
    aria-label="重置抽奖次数"
    title="重置抽奖次数"
    @click="openResetModal"
  >
    🔄
  </button>

  <div class="lottery-card">
    <div class="lottery-grid" :class="{ spinning: rolling }">
      <template v-for="cell in 9" :key="cell">
        <!-- 中间抽奖按钮 -->
        <button
          v-if="cell - 1 === BUTTON_CELL"
          class="grid-button"
          :class="{ disabled: !canDraw }"
          :disabled="!canDraw"
          @click="startRoll"
        >
          {{ buttonText }}
        </button>

        <!-- 奖品格子：平时只显示图片，开奖落在该格子时才揭示名称 -->
        <div
          v-else
          class="grid-cell"
          :class="{ active: cell - 1 === activeCell }"
          :style="{ '--d': ((cell - 1) * 0.09).toFixed(2) + 's' }"
        >
          <img
            class="prize-img"
            :src="cellPrize(cell - 1).image"
            :alt="cellPrize(cell - 1).name"
          />
          <Transition name="reveal">
            <span v-if="isWinnerCell(cell - 1)" class="prize-name-tag">
              {{ cellPrize(cell - 1).name }}
            </span>
          </Transition>
        </div>
      </template>
    </div>

    <p class="remaining-tip">
      剩余抽奖次数：<b>{{ remaining === Infinity ? '∞' : remaining }}</b>
      <span class="pool-tip">｜本奖池共 <b>{{ prizePool.length }}</b> 种奖品，每轮随机上格</span>
    </p>
  </div>

  <!-- 自定义奖品编辑弹窗 -->
  <Transition name="pop">
    <div v-if="editorOpen" class="result-mask editor-mask" @click.self="closeEditor">
      <div class="result-dialog editor-dialog">
        <button class="dialog-close" @click="closeEditor">✕</button>
        <p class="editor-title">自定义奖品池</p>
        <p class="editor-subtitle">
          改名称、传图片、调权重、增删奖品，改动实时保存到本地浏览器；每轮从池中随机抽 8 个上格子
        </p>

        <div class="edit-list">
          <div v-for="(p, i) in prizePool" :key="p.id" class="edit-row">
            <div class="row-preview">
              <img :src="p.image || fallbackImg" alt="" />
            </div>
            <div class="row-main">
              <input
                v-model="p.name"
                class="row-name"
                type="text"
                maxlength="12"
                placeholder="输入奖品名称"
              />
              <div class="row-actions">
                <label class="mini-btn">
                  {{ p.image ? '换图片' : '传图片' }}
                  <input type="file" accept="image/*" hidden @change="onImageChange($event, i)" />
                </label>
                <button v-if="p.image" class="mini-btn ghost" @click="p.image = ''">移除图</button>
                <label class="weight-box">
                  权重
                  <input v-model.number="p.weight" type="number" min="1" max="999" />
                </label>
              </div>
            </div>
            <button
              v-if="canRemove"
              class="row-del"
              type="button"
              title="删除该奖品"
              @click="removePrize(i)"
            >
              ✕
            </button>
          </div>

          <button class="add-prize" type="button" @click="addPrize">＋ 添加奖品</button>
        </div>

        <p class="editor-error">{{ editorError || '　' }}</p>

        <div class="editor-footer">
          <button class="ghost-btn" @click="resetPool">恢复默认</button>
          <button class="dialog-button slim" @click="closeEditor">完成</button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- 重置抽奖验证弹窗：名称 + ID 校验通过才能重置 -->
  <Transition name="pop">
    <div v-if="resetModalOpen" class="result-mask reset-mask" @click.self="closeResetModal">
      <div class="result-dialog reset-dialog">
        <button class="dialog-close" @click="closeResetModal">✕</button>
        <p class="editor-title">🔒 重置抽奖次数</p>
        <p class="editor-subtitle">
          该操作将恢复全部抽奖次数，请输入管理员名称与 ID 验证
        </p>

        <div class="reset-fields">
          <label class="reset-field">
            <span>名称</span>
            <input
              v-model="resetName"
              type="text"
              placeholder="请输入管理员名称"
              autocomplete="off"
              @keyup.enter="confirmReset"
            />
          </label>
          <label class="reset-field">
            <span>ID</span>
            <input
              v-model="resetId"
              type="password"
              placeholder="请输入管理员 ID"
              autocomplete="off"
              @keyup.enter="confirmReset"
            />
          </label>
        </div>

        <p class="editor-error">{{ resetError || '　' }}</p>

        <div class="editor-footer">
          <button class="ghost-btn" @click="closeResetModal">取消</button>
          <button class="dialog-button slim" @click="confirmReset">确认重置</button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- 中奖弹窗 -->
  <Transition name="pop">
    <div v-if="winner" class="result-mask" @click.self="closeResult">
      <div class="result-dialog">
        <button class="dialog-close" @click="closeResult">✕</button>
        <p class="result-title">🎉 恭喜中奖 🎉</p>
        <div class="result-icon">
          <img class="result-img" :src="winner.prize.image || fallbackImg" alt="" />
        </div>
        <!-- <p class="result-name">{{ winner.prize.name }}</p> -->
        <button class="dialog-button" @click="closeResult">知道了</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.lottery-card {
  background: linear-gradient(160deg, #fff7e6, #ffe9d6);
  border-radius: 20px;
  padding: 22px;
  box-shadow: 0 18px 40px rgba(150, 60, 0, 0.25),
    inset 0 0 0 6px rgba(255, 255, 255, 0.55);
}

/* 隐形入口（右上编辑 / 左上重置）：透明热区占位，鼠标移近才浮现 */
.secret-edit,
.secret-reset {
  position: fixed;
  top: 10px;
  z-index: 90;
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  line-height: 1;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  background: transparent;
  color: inherit;
  opacity: 0;
  transition: opacity 0.25s ease, background 0.25s ease, transform 0.15s ease,
    box-shadow 0.25s ease;
}

.secret-edit {
  right: 10px;
}

.secret-reset {
  left: 10px;
}

.secret-edit:hover,
.secret-edit:focus-visible,
.secret-reset:hover,
.secret-reset:focus-visible {
  opacity: 0.92;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 4px 14px rgba(120, 50, 0, 0.3);
}

.secret-edit:active,
.secret-reset:active {
  transform: scale(0.92);
}

.lottery-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.grid-cell {
  position: relative;
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #fff;
  border-radius: 12px;
  border: 2px solid transparent;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease,
    background 0.15s ease,
    border-color 0.15s ease;
}

.grid-cell.active {
  transform: scale(1.06);
  background: linear-gradient(160deg, #fff3c2, #ffd98a);
  border-color: #f5a623;
  box-shadow: 0 0 18px rgba(245, 166, 35, 0.75);
}

.prize-img {
  width: 64px;
  height: 64px;
  object-fit: contain;
}

/* 开奖揭示的名称胶囊：平时隐藏，指针落在中奖格子时弹出 */
.prize-name-tag {
  position: absolute;
  bottom: 7px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 94%;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: linear-gradient(90deg, rgba(232, 68, 44, 0.95), rgba(255, 138, 61, 0.95));
  box-shadow: 0 4px 10px rgba(200, 60, 20, 0.45);
}

.reveal-enter-active {
  transition:
    transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.25s ease;
}

.reveal-leave-active {
  transition: opacity 0.15s ease;
}

.reveal-enter-from {
  transform: translateX(-50%) scale(0.4);
  opacity: 0;
}

.reveal-leave-to {
  opacity: 0;
}

/* 常驻华丽效果：格子辉光波浪（错峰延迟依次亮起）+ 物品轻快跳动 */
.grid-cell {
  animation: cellGlow 2.8s ease-in-out infinite;
  animation-delay: var(--d, 0s);
}

@keyframes cellGlow {
  0%,
  100% {
    box-shadow: 0 0 0 rgba(245, 140, 35, 0);
  }
  50% {
    box-shadow: 0 0 16px rgba(245, 140, 35, 0.5);
  }
}

.grid-cell .prize-img {
  animation: itemPop 0.22s ease infinite alternate;
  animation-delay: var(--d, 0s);
}

@keyframes itemPop {
  from {
    transform: scale(0.94);
    opacity: 0.82;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

/* 滚动时停用闲置辉光，突出高亮扫过的格子 */
.lottery-grid.spinning .grid-cell {
  animation-name: none;
}

.grid-button {
  aspect-ratio: 1;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.4;
  white-space: pre-line;
  text-shadow: 0 1px 2px rgba(120, 30, 0, 0.45);
  background: radial-gradient(circle at 50% 32%, #ff7d54, #e8442c 62%, #c22a17);
  box-shadow: inset 0 -4px 8px rgba(120, 20, 0, 0.35), 0 6px 14px rgba(200, 50, 20, 0.4);
  transition: filter 0.15s ease, transform 0.1s ease;
}

.grid-button:hover:not(.disabled) {
  filter: brightness(1.08);
}

.grid-button:active:not(.disabled) {
  transform: scale(0.96);
}

.grid-button.disabled {
  cursor: not-allowed;
  filter: grayscale(0.65) brightness(0.92);
}

.remaining-tip {
  margin-top: 14px;
  text-align: center;
  font-size: 13px;
  color: #9a6a2f;
}

.remaining-tip b {
  color: #d43f00;
  font-size: 15px;
}

.pool-tip {
  font-size: 12px;
  opacity: 0.75;
}

/* ---------- 弹窗公共 ---------- */
.result-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(30, 10, 0, 0.55);
  backdrop-filter: blur(3px);
}

.editor-mask {
  z-index: 110;
}

.result-dialog {
  position: relative;
  width: 300px;
  padding: 34px 24px 28px;
  text-align: center;
  border-radius: 18px;
  background: linear-gradient(170deg, #fffdf6, #fff1dc);
  box-shadow: 0 24px 60px rgba(60, 20, 0, 0.45);
}

.dialog-close {
  position: absolute;
  top: 10px;
  right: 12px;
  border: none;
  background: transparent;
  font-size: 16px;
  color: #b08a5a;
  cursor: pointer;
  z-index: 1;
}

.dialog-button {
  min-width: 140px;
  padding: 10px 0;
  border: none;
  border-radius: 999px;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 4px;
  cursor: pointer;
  background: linear-gradient(90deg, #ff8a3d, #e8442c);
  box-shadow: 0 6px 14px rgba(220, 70, 30, 0.4);
  transition: filter 0.15s ease;
}

.dialog-button:hover {
  filter: brightness(1.07);
}

.dialog-button.slim {
  min-width: 96px;
  letter-spacing: 2px;
  padding: 9px 18px;
}

/* ---------- 编辑器 ---------- */
.editor-dialog {
  width: min(540px, 94vw);
  text-align: left;
  padding-bottom: 22px;
}

.editor-title {
  font-size: 20px;
  font-weight: 700;
  color: #c22a17;
  text-align: center;
}

.editor-subtitle {
  margin: 6px 0 14px;
  font-size: 12px;
  line-height: 1.6;
  color: #b08a5a;
  text-align: center;
}

.edit-list {
  max-height: 54vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px;
}

.edit-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  background: #fff;
  border: 1.5px solid #f2ddba;
  border-radius: 12px;
}

.row-preview {
  flex-shrink: 0;
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  line-height: 1;
  background: #fff7ea;
  border-radius: 10px;
  overflow: hidden;
}

.row-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.row-name {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  font-size: 14px;
  color: #6b4a17;
  background: #fffdf8;
  border: 1.5px solid #ecd3ae;
  border-radius: 8px;
  outline: none;
  transition: border-color 0.15s ease;
}

.row-name:focus {
  border-color: #f5a623;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.mini-btn {
  display: inline-flex;
  align-items: center;
  padding: 5px 11px;
  border: none;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  color: #fff;
  background: linear-gradient(90deg, #ffab52, #f2701f);
  box-shadow: 0 3px 8px rgba(230, 110, 30, 0.35);
  transition: filter 0.15s ease;
}

.mini-btn:hover {
  filter: brightness(1.06);
}

.mini-btn.ghost {
  color: #a3762f;
  background: transparent;
  border: 1.5px solid #dcb887;
  box-shadow: none;
}

.weight-box {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #a3762f;
}

.weight-box input {
  width: 54px;
  height: 26px;
  padding: 0 6px;
  font-size: 12px;
  color: #6b4a17;
  border: 1.5px solid #ecd3ae;
  border-radius: 6px;
  outline: none;
  background: #fffdf8;
}

.weight-box input:focus {
  border-color: #f5a623;
}

.row-del {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  font-size: 12px;
  line-height: 1;
  color: #c0392b;
  background: transparent;
  cursor: pointer;
  opacity: 0.45;
  transition: opacity 0.15s ease, background 0.15s ease;
}

.row-del:hover {
  opacity: 1;
  background: #ffe9e2;
}

.add-prize {
  margin-top: 2px;
  padding: 11px 0;
  border: 1.5px dashed #dcb887;
  border-radius: 12px;
  background: transparent;
  font-size: 14px;
  font-weight: 600;
  color: #a3762f;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.add-prize:hover {
  background: #fffaf2;
  color: #c22a17;
}

.editor-error {
  height: 18px;
  margin-top: 8px;
  font-size: 12px;
  color: #d43f00;
  text-align: center;
}

.editor-footer {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
}

.ghost-btn {
  padding: 9px 18px;
  border: 1.5px solid #dcb887;
  border-radius: 999px;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  color: #a3762f;
  cursor: pointer;
  transition: filter 0.15s ease;
}

.ghost-btn:hover {
  filter: brightness(1.05);
  background: #fffaf2;
}

/* ---------- 中奖弹窗内容 ---------- */
.result-title {
  font-size: 20px;
  font-weight: 700;
  color: #c22a17;
}

.result-icon {
  font-size: 64px;
  line-height: 1.25;
  animation: bounce 0.9s ease infinite alternate;
}

.result-img {
  width: 96px;
  height: 96px;
  object-fit: contain;
  vertical-align: middle;
}

@keyframes bounce {
  from {
    transform: translateY(0) scale(1);
  }
  to {
    transform: translateY(-8px) scale(1.08);
  }
}

.result-name {
  margin: 8px 0 20px;
  font-size: 17px;
  font-weight: 600;
  color: #7a4a00;
}

/* 弹窗过渡动画 */
.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.25s ease;
}

.pop-enter-active .result-dialog,
.pop-leave-active .result-dialog {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
}

.pop-enter-from .result-dialog {
  transform: scale(0.6);
}

/* ---------------- 重置验证弹窗 ---------------- */
.reset-dialog {
  width: min(88vw, 340px);
}

.reset-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 18px;
}

.reset-field {
  display: flex;
  align-items: center;
  gap: 10px;
}

.reset-field span {
  flex: 0 0 42px;
  text-align: right;
  font-size: 14px;
  color: #8a93a6;
}

.reset-field input {
  flex: 1;
  height: 40px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.07);
  color: inherit;
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.reset-field input::placeholder {
  color: rgba(160, 168, 184, 0.55);
}

.reset-field input:focus {
  border-color: var(--primary, #ffb02e);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary, #ffb02e) 25%, transparent);
}
</style>
