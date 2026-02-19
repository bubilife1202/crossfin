import DefaultTheme from 'vitepress/theme'
import './custom.css'
import ApiTable from './components/ApiTable.vue'
import ToolGrid from './components/ToolGrid.vue'
import Steps from './components/Steps.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ApiTable', ApiTable)
    app.component('ToolGrid', ToolGrid)
    app.component('Steps', Steps)
  }
}
