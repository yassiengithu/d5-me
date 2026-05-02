CREATE TABLE public.shipments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  order_id UUID,
  easyship_shipment_id TEXT,
  tracking_number TEXT,
  label_url TEXT,
  courier_id TEXT,
  courier_name TEXT,
  sender JSONB NOT NULL,
  receiver JSONB NOT NULL,
  parcel JSONB NOT NULL,
  cost NUMERIC,
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  raw_response JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_shipments_user_id ON public.shipments(user_id);
CREATE INDEX idx_shipments_order_id ON public.shipments(order_id);
CREATE INDEX idx_shipments_easyship_id ON public.shipments(easyship_shipment_id);

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own shipments"
ON public.shipments FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all shipments"
ON public.shipments FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can create their own shipments"
ON public.shipments FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own shipments"
ON public.shipments FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE TRIGGER set_shipments_updated_at
BEFORE UPDATE ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();