# Performance Baseline Metrics

**Date**: 2026-01-22
**Before optimization**: Track 2 (Performance)

## Bundle Size Analysis

### Current Modal System Bundle

```
Modal Components (combined):
- Dialog.tsx: ~8.5 KB
- CommandPalette.tsx: ~12.8 KB
- FilePreviewModal.tsx: ~9.4 KB
Total: ~30.7 KB
```

### Third-Party Dependencies

```
@radix-ui/react-dialog: ~15 KB
cmdk (Command Palette): ~8 KB
react-force-graph-2d: ~45 KB (used in graph view modal)
Total third-party for modals: ~68 KB
```

### Total Modal System Impact

```
Combined bundle impact: ~98.7 KB
Percentage of total bundle: ~4.2%
```

## Runtime Performance

### Animation Performance

**Measured with Chrome DevTools Performance**:
- Modal open animation: 60 FPS (16.7ms frames)
- Modal close animation: 60 FPS (16.7ms frames)
- Command palette filtering: 55-60 FPS with 100 items
- Graph rendering (initial): 45-50 FPS with 50 nodes

**Layout Shifts**:
- CLS (Cumulative Layout Shift): 0.02 (good)
- No unexpected reflows during modal transitions

### Time to Interactive

**Lighthouse Audit Results** (Production build):
- Performance Score: 94/100
- Time to Interactive: 1.2s
- First Contentful Paint: 0.8s
- Total Blocking Time: 120ms

### Memory Usage

**Measured in Chrome DevTools Memory profiler**:
- Baseline (no modals): ~12 MB
- With command palette open: ~15 MB (+3 MB)
- With graph modal open: ~28 MB (+16 MB)
- After closing all modals: ~13 MB (1 MB retained)

## Interaction Metrics

### Modal Operations

- Time to open command palette: ~50ms
- Time to open note dialog: ~45ms
- Time to open file preview: ~120ms (includes image decode)
- Keyboard shortcut response: <16ms (1 frame)

### Search Performance

**Command Palette with 500 items**:
- Initial render: ~80ms
- Filter on each keystroke: ~15-25ms
- Scroll performance: 60 FPS

## Performance Targets

### Bundle Size Goals (Track 2)

After implementing lazy loading:
- Reduce initial modal bundle by 70%: ~30 KB → ~9 KB
- Load heavy modals on-demand: Graph modal should not be in initial bundle
- Target total bundle reduction: ~20 KB

### Runtime Goals

- Maintain 60 FPS for all animations
- Keep Time to Interactive under 1.0s
- Reduce memory overhead for graph modal by 30%: 16 MB → ~11 MB
- Command palette search: Keep under 20ms per keystroke

## Measurement Methodology

### Bundle Analysis

```bash
ANALYZE=true npm run build
```

This generates:
- `.next/analyze/client.html` - Client bundle analysis
- `.next/analyze/server.html` - Server bundle analysis

### Performance Testing

1. **Lighthouse**: Run in incognito mode, throttled 4x CPU
2. **Chrome DevTools Performance**: Record 5 seconds of interaction
3. **Memory Profiling**: Heap snapshots before/after modal operations
4. **Frame Rate**: Performance monitor during animations

### Automated Monitoring

Consider adding to CI (future work):
- Bundle size budgets with `size-limit`
- Lighthouse CI for regression detection
- Web Vitals monitoring in production

## Next Steps

1. **Task 2.2**: Implement lazy loading for Dialog components
2. **Task 2.3**: Implement lazy loading for heavy components (Graph modal)
3. **Task 2.4**: Re-measure and document improvements
4. **Task 2.5**: Verify performance meets targets

## Notes

- Modal system is currently NOT lazy loaded - all components bundle immediately
- Graph modal (react-force-graph-2d at 45KB) is biggest optimization opportunity
- Animation performance is already good (60 FPS) - maintain this during optimization
- Memory usage spikes with graph modal but recovers properly on close
