export type PublicOutlet = {
  id: number;
  code: string;
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  openingTime: string;
  closingTime: string;
  deliveryRadiusKm: number;
  minimumOrder: number;
  status: string;
  services: {
    dineIn: boolean;
    takeaway: boolean;
    delivery: boolean;
    pos: boolean;
    onlineOrdering: boolean;
  } | null;
};
