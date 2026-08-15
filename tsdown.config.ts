import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-usage-stats',
  ['src/index.ts'],
  {
    lib: {
      external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-settings'],
    },
  },
)
