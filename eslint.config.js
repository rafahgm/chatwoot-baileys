import antfu from '@antfu/eslint-config'

export default antfu({
  typescript: true,
  node: true,
}, {
  rules: {
    'n/prefer-global/process': 'off',
  },
})
