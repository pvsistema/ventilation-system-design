import type { Config } from "tailwindcss";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
			"./1777863345338291256.html"
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px'
			}
		},
		fontFamily: {
			sans: ['"Golos Text"', '"IBM Plex Sans"', 'sans-serif'],
			mono: ['"JetBrains Mono"', '"IBM Plex Mono"', 'monospace'],
		},
		extend: {
			colors: {
				// ── «Горная» палитра ────────────────────────────────────────
				// Вместо офисного синего Tailwind — сине-стальной (воздух, металл
				// крепи, базовый тон #1e5a7a = steel-700). Шкала переопределена
				// целиком, поэтому все text-blue-*/bg-blue-*/border-blue-* в
				// интерфейсе меняются разом. Цвета на САМОЙ СХЕМЕ (синяя
				// исходящая струя и т.п.) заданы отдельно и не затронуты —
				// это отраслевое обозначение.
				blue: {
					50:  '#eef5f8',
					100: '#d7e7ee',
					200: '#b0cfdc',
					300: '#81b0c4',
					400: '#4f8ca6',
					500: '#2f7290',
					600: '#236582',
					700: '#1e5a7a',
					800: '#1a4a64',
					900: '#173d52',
					950: '#0e2533',
				},
				steel: {
					50:  '#eef5f8', 100: '#d7e7ee', 200: '#b0cfdc', 300: '#81b0c4',
					400: '#4f8ca6', 500: '#2f7290', 600: '#236582', 700: '#1e5a7a',
					800: '#1a4a64', 900: '#173d52', 950: '#0e2533',
				},
				// Сигнальный янтарь — цвет каски и светоотражающих полос
				amber: {
					50:  '#fffaeb',
					100: '#fef1c7',
					200: '#fde28a',
					300: '#fbcd4d',
					400: '#f5b83d',
					500: '#e8a317',
					600: '#c98a0c',
					700: '#a66b0d',
					800: '#865412',
					900: '#6e4513',
					950: '#3f2406',
				},
				// Антрацит — тёмные элементы вместо чёрного
				anthracite: {
					DEFAULT: '#2b2f33',
					900: '#1f2328',
					800: '#2b2f33',
					700: '#3a3f45',
				},
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))'
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				sidebar: {
					DEFAULT: 'hsl(var(--sidebar-background))',
					foreground: 'hsl(var(--sidebar-foreground))',
					primary: 'hsl(var(--sidebar-primary))',
					'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
					accent: 'hsl(var(--sidebar-accent))',
					'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
					border: 'hsl(var(--sidebar-border))',
					ring: 'hsl(var(--sidebar-ring))'
				}
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)'
			},
			keyframes: {
				'accordion-down': {
					from: {
						height: '0'
					},
					to: {
						height: 'var(--radix-accordion-content-height)'
					}
				},
				'accordion-up': {
					from: {
						height: 'var(--radix-accordion-content-height)'
					},
					to: {
						height: '0'
					}
				}
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out'
			}
		}
	},
	plugins: [require("tailwindcss-animate")],
} satisfies Config;