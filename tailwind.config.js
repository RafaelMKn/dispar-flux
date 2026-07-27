/** @type {import('tailwindcss').Config} */
// Mapeamento dos tokens do design system (definidos em src/renderer/src/index.css)
// para utilitarios do Tailwind. As cores apontam para CSS variables, por isso o
// tema claro/escuro troca sozinho via [data-theme] — sem variantes duplicadas.
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          base: 'var(--surface-base)',
          raised: 'var(--surface-raised)',
          sunken: 'var(--surface-sunken)'
        },
        line: {
          DEFAULT: 'var(--border)',
          subtle: 'var(--border-subtle)'
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          strong: 'var(--accent-strong)',
          text: 'var(--accent-text)',
          wash: 'var(--accent-wash)',
          washStrong: 'var(--accent-wash-strong)'
        },
        btn: {
          DEFAULT: 'var(--btn)',
          hover: 'var(--btn-hover)',
          active: 'var(--btn-active)',
          ink: 'var(--btn-ink)'
        },
        ink: {
          DEFAULT: 'var(--ink)',
          secondary: 'var(--ink-secondary)',
          tertiary: 'var(--ink-tertiary)',
          meta: 'var(--ink-meta)'
        },
        state: {
          success: 'var(--success)',
          successText: 'var(--success-text)',
          successWash: 'var(--success-wash)',
          warning: 'var(--warning)',
          warningText: 'var(--warning-text)',
          warningWash: 'var(--warning-wash)',
          danger: 'var(--danger)',
          dangerText: 'var(--danger-text)',
          dangerWash: 'var(--danger-wash)'
        }
      },
      fontFamily: {
        sans: [
          'Segoe UI Variable Text',
          'Segoe UI Variable',
          'Segoe UI',
          'system-ui',
          '-apple-system',
          'sans-serif'
        ],
        serif: ['Iowan Old Style', 'Georgia', 'Times New Roman', 'serif']
      },
      fontSize: {
        xs: ['12px', '1.5'],
        sm: ['13px', '1.5'],
        base: ['14px', '1.5'],
        lg: ['16px', '1.5'],
        xl: ['20px', '1.25'],
        '2xl': ['24px', '1.2'],
        '3xl': ['32px', '1.2']
      },
      borderRadius: {
        DEFAULT: '6px',
        md: '6px',
        lg: '10px',
        xl: '14px',
        full: '999px'
      },
      boxShadow: {
        flat: 'var(--shadow-flat)',
        float: 'var(--shadow-float)'
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(.2,.8,.3,1)'
      },
      transitionDuration: {
        120: '120ms',
        180: '180ms'
      },
      maxWidth: {
        form: '1120px'
      }
    }
  },
  plugins: []
}
