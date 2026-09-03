import { ShieldKeyhole } from '@gravity-ui/icons';

export function BrandMark() {
  return (
    <div className="auth-brand" aria-label="SevaleCRM">
      <span className="auth-brand-mark" aria-hidden="true">
        <ShieldKeyhole width={35} height={35} />
      </span>
      <span className="auth-brand-name">SevaleCRM</span>
    </div>
  );
}
