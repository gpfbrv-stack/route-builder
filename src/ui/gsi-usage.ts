import type L from 'leaflet';
import { GSI_ATTRIBUTION } from '../config';

export const GSI_ROAD_ATTRIBUTION = `道路中心線: ${GSI_ATTRIBUTION}`;
export const GSI_NOTICE = '地理院の道で引いた区間は通行可否を確認していません(廃道・通行止めを含む場合があります)';

/** Attribute active GSI geometry; announce the advisory once per app session. */
export class GsiUsage {
  private active = false;
  private announced = false;
  constructor(private attribution: L.Control.Attribution, private notify: (message: string) => void) {}
  update(active: boolean) {
    if (active !== this.active) {
      if (active) this.attribution.addAttribution(GSI_ROAD_ATTRIBUTION);
      else this.attribution.removeAttribution(GSI_ROAD_ATTRIBUTION);
      this.active = active;
    }
    if (active && !this.announced) { this.announced = true; this.notify(GSI_NOTICE); }
  }
}
