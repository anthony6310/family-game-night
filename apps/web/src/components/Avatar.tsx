/** Shows the avatar image, or the name's first letter when there is none (e.g. guests). */
export function Avatar({ url, name, size = 64 }: { url?: string | null; name: string; size?: number }) {
  const style = { width: size, height: size, fontSize: size / 2 };
  return url ? (
    <img className="avatar" src={url} alt="" style={style} />
  ) : (
    <span className="avatar initial" style={style}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
