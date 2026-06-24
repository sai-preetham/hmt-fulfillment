'use client';

import { useState } from 'react';

export function CrmSettingsForm({ settings, supabaseConfigured }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    const response = await fetch('/api/crm/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error || 'Settings update failed.');
      return;
    }
    setMessage(data.demo ? 'Settings validated in demo mode. Configure Supabase to persist.' : 'Settings saved.');
  }

  const shipment = settings.shipment_defaults;
  const pickup = settings.pickup_defaults;
  const international = settings.international_export_defaults;
  const automation = settings.automation_defaults;

  return (
    <form onSubmit={submit} className="grid">
      {!supabaseConfigured ? <p className="muted">Supabase is not configured, so changes will validate but not persist.</p> : null}

      <section className="panel">
        <div className="panelHeader"><h2>Package defaults</h2></div>
        <div className="panelBody formGrid">
          <label>
            <span>Domestic weight (grams)</span>
            <input name="domestic_weight_grams" type="number" defaultValue={shipment.domestic.weightGrams} />
          </label>
          <label>
            <span>Domestic length (cm)</span>
            <input name="domestic_length_cm" type="number" defaultValue={shipment.domestic.lengthCm} />
          </label>
          <label>
            <span>Domestic width (cm)</span>
            <input name="domestic_width_cm" type="number" defaultValue={shipment.domestic.widthCm} />
          </label>
          <label>
            <span>Domestic height (cm)</span>
            <input name="domestic_height_cm" type="number" defaultValue={shipment.domestic.heightCm} />
          </label>
          <label>
            <span>International weight (grams)</span>
            <input name="international_weight_grams" type="number" defaultValue={shipment.international.weightGrams} />
          </label>
          <label>
            <span>International length (cm)</span>
            <input name="international_length_cm" type="number" defaultValue={shipment.international.lengthCm} />
          </label>
          <label>
            <span>International width (cm)</span>
            <input name="international_width_cm" type="number" defaultValue={shipment.international.widthCm} />
          </label>
          <label>
            <span>International height (cm)</span>
            <input name="international_height_cm" type="number" defaultValue={shipment.international.heightCm} />
          </label>
          <label>
            <span>Default payment mode</span>
            <select name="payment_mode" defaultValue={shipment.paymentMode}>
              <option>Prepaid</option>
              <option>COD</option>
            </select>
          </label>
          <label>
            <span>Domestic service</span>
            <select name="domestic_service_code" defaultValue={shipment.domesticServiceCode}>
              <option value="express">Express</option>
              <option value="surface">Surface</option>
              <option value="reverse_pickup">Reverse pickup</option>
            </select>
          </label>
          <label>
            <span>International service</span>
            <select name="international_service_code" defaultValue={shipment.internationalServiceCode}>
              <option value="dlv_saver">DLV Saver</option>
              <option value="deferred_express">Deferred Express</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader"><h2>Pickup and tax</h2></div>
        <div className="panelBody formGrid">
          <label>
            <span>Pickup location</span>
            <input name="pickup_location" defaultValue={pickup.pickupLocation} />
          </label>
          <label>
            <span>Pickup pincode</span>
            <input name="pickup_pincode" defaultValue={pickup.pickupPincode} />
          </label>
          <label>
            <span>GSTIN</span>
            <input name="seller_gst_tin" defaultValue={pickup.sellerGstTin} />
          </label>
          <label>
            <span>HSN code</span>
            <input name="hsn_code" defaultValue={pickup.hsnCode} />
          </label>
          <label>
            <span>Return name</span>
            <input name="return_name" defaultValue={pickup.returnName} />
          </label>
          <label>
            <span>Return phone</span>
            <input name="return_phone" defaultValue={pickup.returnPhone} />
          </label>
          <label className="full">
            <span>Return address</span>
            <input name="return_address" defaultValue={pickup.returnAddress} />
          </label>
          <label>
            <span>Return city</span>
            <input name="return_city" defaultValue={pickup.returnCity} />
          </label>
          <label>
            <span>Return state</span>
            <input name="return_state" defaultValue={pickup.returnState} />
          </label>
          <label>
            <span>Return pincode</span>
            <input name="return_pincode" defaultValue={pickup.returnPincode} />
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader"><h2>International export</h2></div>
        <div className="panelBody formGrid">
          <label>
            <span>Shipment type</span>
            <input name="international_shipment_type" defaultValue={international.shipmentType} />
          </label>
          <label>
            <span>Purpose of booking</span>
            <input name="international_purpose_of_booking" defaultValue={international.purposeOfBooking} />
          </label>
          <label>
            <span>Invoice terms</span>
            <input name="invoice_terms" defaultValue={international.invoiceTerms} />
          </label>
          <label>
            <span>Product category</span>
            <input name="international_product_category" defaultValue={international.productCategory} />
          </label>
          <label>
            <span>HTS code</span>
            <input name="hts_code" defaultValue={international.htsCode} />
          </label>
          <label className="full">
            <span>Product description</span>
            <input name="international_product_description" defaultValue={international.productDescription} />
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader"><h2>Automation</h2></div>
        <div className="panelBody formGrid">
          <label className="checkItem">
            <input type="checkbox" name="wix_fulfillment_sync_enabled" defaultChecked={automation.wixFulfillmentSyncEnabled} />
            <span>Update Wix fulfillment after booking</span>
          </label>
          <label className="checkItem">
            <input type="checkbox" name="tracking_enabled" defaultChecked={automation.trackingEnabled} />
            <span>Enable Delhivery tracking polling</span>
          </label>
          <label>
            <span>Tracking interval (minutes)</span>
            <input name="tracking_interval_minutes" type="number" defaultValue={automation.trackingIntervalMinutes} />
          </label>
          <label>
            <span>Tracking batch size</span>
            <input name="tracking_batch_size" type="number" defaultValue={automation.trackingBatchSize} />
          </label>
        </div>
      </section>

      <div className="toolbar">
        <button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save settings'}</button>
        {message ? <span className="muted">{message}</span> : null}
      </div>
    </form>
  );
}
