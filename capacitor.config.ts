import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.bookeasy.app',
  appName: 'BookEasy',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
  },
}

export default config
