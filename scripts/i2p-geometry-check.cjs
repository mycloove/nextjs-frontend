import('./i2p-geometry-check.mjs').catch((error) => {
  console.error(error)
  process.exitCode = 1
})
