/** Decorative orbit rings around the logo. Purely visual, so hidden from assistive tech. */
export function OrbitArt({ size = 320, className = '' }: { size?: number; className?: string }) {
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden>
      <div className="absolute inset-[34%] rounded-full bg-brand/25 blur-3xl" />
      <div className="absolute inset-[4%] rounded-full border border-brand/20" />
      <div className="animate-orbit absolute inset-[4%]">
        <span className="absolute top-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_16px_var(--c-accent)]" />
      </div>
      <div className="absolute inset-[20%] rounded-full border border-dashed border-brand/25" />
      <div className="animate-orbit-slow absolute inset-[20%]">
        <span className="absolute top-1/2 right-0 h-2 w-2 translate-x-1/2 -translate-y-1/2 rounded-full bg-brand shadow-[0_0_12px_var(--c-brand)]" />
      </div>
      <div className="absolute inset-[36%] rounded-full border border-brand/15" />
      <img
        src="/logo.png"
        alt=""
        className="absolute inset-[27%] h-[46%] w-[46%] object-contain drop-shadow-[0_8px_24px_rgba(21,115,232,0.45)]"
      />
    </div>
  );
}
