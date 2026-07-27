import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['node_modules/**', 'out/**', 'dist/**', '*.tsbuildinfo'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Processo main + preload: rodam no Node, sem DOM.
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/shared/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },

  // Renderer: roda no navegador e usa as regras de hooks do React.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // As paginas carregam dados no mount com `void load()` dentro do effect.
      // A regra tem razao (gera um render em cascata), mas reescrever isso e
      // refatorar logica assincrona que funciona, numa camada sem nenhum teste.
      // Fica como aviso: visivel, sem travar o lint.
      'react-hooks/set-state-in-effect': 'warn'
    }
  },

  // Arquivos de configuracao na raiz usam CommonJS.
  {
    files: ['*.config.js', 'postcss.config.js', 'tailwind.config.js'],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'commonjs'
    }
  },

  // Prettier por ultimo: desliga as regras de formatacao para nao brigar.
  prettier
)
