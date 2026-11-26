export function BrandLogo({ size = 28 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" className="shrink-0">
			<defs>
				<linearGradient id="navCyanFlow" x1="0%" y1="0%" x2="100%" y2="100%">
					<stop offset="0%" stopColor="#7DD3FC" />
					<stop offset="55%" stopColor="#38BDF8" />
					<stop offset="100%" stopColor="#0284C7" />
				</linearGradient>
				<linearGradient id="navEmeraldFlow" x1="0%" y1="100%" x2="100%" y2="0%">
					<stop offset="0%" stopColor="#059669" />
					<stop offset="55%" stopColor="#10B981" />
					<stop offset="100%" stopColor="#6EE7B7" />
				</linearGradient>
			</defs>
			<rect x="10" y="10" width="236" height="236" rx="54" fill="#070C18" stroke="#334155" strokeWidth="4" />
			<path
				d="M56 106 C56 72, 82 54, 118 54 L180 54 C190 54, 198 62, 198 72 C198 82, 190 90, 180 90 L120 90 C102 90, 92 98, 92 114 L92 118 L56 118 Z"
				fill="url(#navCyanFlow)"
			/>
			<path
				d="M200 150 C200 184, 174 202, 138 202 L76 202 C66 202, 58 194, 58 184 C58 174, 66 166, 76 166 L136 166 C154 166, 164 158, 164 142 L164 138 L200 138 Z"
				fill="url(#navEmeraldFlow)"
			/>
			<rect
				x="97"
				y="97"
				width="62"
				height="62"
				rx="16"
				transform="rotate(45 128 128)"
				fill="#080E1C"
				stroke="#E2E8F0"
				strokeOpacity="0.25"
				strokeWidth="3"
			/>
			<path
				d="M112 130 L123 141 L143 121"
				fill="none"
				stroke="#6EE7B7"
				strokeWidth="9"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<circle cx="180" cy="72" r="5" fill="#E0F2FE" />
			<circle cx="76" cy="184" r="5" fill="#D1FAE5" />
		</svg>
	)
}
