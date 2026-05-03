import { useSearchParams } from "react-router-dom";
import PageHeader from "@/components/PageHeader";
import ShipmentTracker from "@/components/ShipmentTracker";

const TrackShipment = () => {
  const [params] = useSearchParams();
  const initial = params.get("tracking_number") ?? "";
  return (
    <div className="container max-w-2xl py-6">
      <PageHeader title="Track Shipment" subtitle="Enter your tracking number to see live updates" />
      <div className="mt-4">
        <ShipmentTracker initialTrackingNumber={initial} />
      </div>
    </div>
  );
};

export default TrackShipment;
