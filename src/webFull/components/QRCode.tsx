/**
 * QR Code Component
 *
 * Generates a QR code for a given URL using the qrcode library.
 * No cloud services - all generation happens locally.
 *
 * Lifted verbatim from `src/renderer/components/QRCode.tsx` (Layer 2.5
 * leaf-parade). The renderer source has 0 IPC namespaces and 0 Electron-only
 * APIs — the only external dependency is the `qrcode` npm package (already a
 * webFull-tree dep) and `captureException` from the local sentry utility,
 * whose import path (`../utils/sentry`) resolves identically from
 * `src/renderer/components/` and `src/webFull/components/`.
 *
 * No import-path adjustments were required. This file is a byte-for-byte
 * copy of the renderer source (modulo this header).
 */

import { memo, useState, useEffect } from 'react';
import QRCodeLib from 'qrcode';
import { captureException } from '../utils/sentry';

interface QRCodeProps {
	/** The URL or text to encode in the QR code */
	value: string;
	/** Size in pixels (default: 128) */
	size?: number;
	/** Background color (default: '#0000' — 4-digit hex transparent). The
	 *  underlying `qrcode` library's `hex2rgba()` synchronously throws
	 *  `Invalid hex color: transparent` on the string 'transparent', so the
	 *  default has to be a hex value. `#0000` is the 4-digit hex form with
	 *  alpha=0, which renders identically to the conceptual default of a
	 *  fully-transparent background. */
	bgColor?: string;
	/** Foreground color (default: white) */
	fgColor?: string;
	/** Alt text for accessibility */
	alt?: string;
	/** Additional CSS classes */
	className?: string;
}

export const QRCode = memo(function QRCode({
	value,
	size = 128,
	bgColor = '#0000',
	fgColor = '#FFFFFF',
	alt = 'QR Code',
	className = '',
}: QRCodeProps) {
	const [dataUrl, setDataUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!value) {
			setDataUrl(null);
			return;
		}

		// Generate QR code as data URL
		QRCodeLib.toDataURL(value, {
			width: size,
			margin: 1,
			color: {
				dark: fgColor,
				light: bgColor,
			},
			errorCorrectionLevel: 'M',
		})
			.then((url) => {
				setDataUrl(url);
				setError(null);
			})
			.catch((err) => {
				captureException(err);
				setError('Failed to generate QR code');
				setDataUrl(null);
			});
	}, [value, size, bgColor, fgColor]);

	if (error) {
		return (
			<div
				className={`flex items-center justify-center ${className}`}
				style={{ width: size, height: size }}
			>
				<span className="text-xs text-red-500">{error}</span>
			</div>
		);
	}

	if (!dataUrl) {
		return (
			<div
				className={`flex items-center justify-center ${className}`}
				style={{ width: size, height: size }}
			>
				<div
					className="animate-pulse rounded"
					style={{ width: size, height: size, backgroundColor: 'rgba(255,255,255,0.1)' }}
				/>
			</div>
		);
	}

	return (
		<img
			src={dataUrl}
			alt={alt}
			width={size}
			height={size}
			className={className}
			style={{ imageRendering: 'pixelated' }}
		/>
	);
});
