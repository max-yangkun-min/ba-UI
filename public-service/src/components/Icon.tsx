type IconProps = {
  name: string;
  size?: number;
};

export function Icon({ name, size = 16 }: IconProps) {
  const url = `url("/icons/${name}.svg")`;
  return (
    <span
      className="icon"
      style={{
        width: size,
        height: size,
        maskImage: url,
        WebkitMaskImage: url,
      }}
      aria-hidden
    />
  );
}
