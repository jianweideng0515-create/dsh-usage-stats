// 构建预设：独立仓库内联的共享副本（源自 dsh-web-ui/shared/tsdown.client.ts）
import { clientBundle } from './tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-usage-stats',
  ['src/index.ts'],
  {
    lib: {
      external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-settings'],
    },
  },
)
