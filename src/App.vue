<script setup>
import NineGridLottery from './components/NineGridLottery.vue'
</script>

<template>
  <div class="page">
    <h1 class="page-title">幸运大抽奖</h1>
    <!-- <p class="page-subtitle">点击中间按钮开始抽奖</p> -->
    <NineGridLottery />
  </div>
</template>

<style scoped>
.page {
  position: relative;
  /* 建立独立堆叠上下文，保证 ::before 的负层级只作用于本页内部 */
  isolation: isolate;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 16px;
  /* 页面背景图：等比铺满、居中、视口固定 */
  background: url('./assets/img/beijing.jpg') center / cover no-repeat fixed;
}

/* 灰色蒙版：压在背景图之上、所有内容之下（调 rgba 最后一位即可改深浅）。
   注意不要用 ".page > *" 抬升内容——那会覆盖弹窗等子组件根节点的
   position: fixed / z-index，导致弹窗溢出到文档流里。 */
.page::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: rgba(70, 70, 70, 0.5);
  pointer-events: none;
}

.page-title {
  color: #fff;
  font-size: 34px;
  letter-spacing: 6px;
  text-shadow: 0 3px 10px rgba(120, 30, 0, 0.45);
}

.page-subtitle {
  color: rgba(255, 245, 230, 0.9);
  font-size: 14px;
  letter-spacing: 2px;
  margin-bottom: 18px;
}
</style>
