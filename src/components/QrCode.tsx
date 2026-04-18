import * as React from 'react'
import QR from 'qrcode'

interface QrCodeProps {
  value: string
  size?: number
  className?: string
}

export function QrCode({ value, size = 168, className }: QrCodeProps) {
  const [svg, setSvg] = React.useState<string>('')

  React.useEffect(() => {
    let cancelled = false
    QR.toString(value, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0a0a0a', light: '#ffffff' },
      width: size,
    }).then((s) => {
      if (!cancelled) setSvg(s)
    })
    return () => {
      cancelled = true
    }
  }, [value, size])

  return (
    <div
      className={className ?? 'rounded-[10px] border border-border bg-white p-2.5'}
      style={{ width: size + 20, height: size + 20 }}
      // Inline SVG is safe — generated locally from a string we control.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
