// 兜底：主脚本异常时 2.5 秒后强制显示原回复；Phase 1 在 document_end 同步完成后会立即撤掉
(window as unknown as { __vxfFallback?: number }).__vxfFallback = window.setTimeout(() => {
  document.documentElement.classList.add('vxf-fallback');
}, 2500);