export const ORDER_STATUSES = [
  'new',
  'not_paid',
  'details_verified',
  'awaiting_packing',
  'packed',
  'shipment_booked',
  'pickup_pending',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'installation_pending',
  'feedback_pending',
  'issue_reported',
  'completed',
  'fulfilled_no_tracking',
  'failed_delivery',
  'rto_initiated',
  'rto_delivered',
  'lost_damaged',
  'pending_international',
  'cancelled',
  'rto',
  'warranty_case'
];

export const SHIPMENT_STATUSES = [
  'not_booked',
  'booked',
  'shipment_booked',
  'pickup_pending',
  'picked_up',
  'in_transit',
  'in-transit',
  'out_for_delivery',
  'delivered',
  'failed_delivery',
  'rto_initiated',
  'rto_delivered',
  'lost_damaged',
  'pending-international'
];

export const INSTALLATION_STATUSES = [
  'not_contacted',
  'guide_sent',
  'video_sent',
  'customer_needs_help',
  'installation_scheduled',
  'installed_successfully',
  'installation_issue',
  'returned_cancelled'
];

export const INSTALLATION_METHODS = [
  'unknown',
  'diy',
  'hmt_bengaluru_store',
  'nearby_garage'
];

export const DELIVERY_METHODS = [
  'unknown',
  'porter',
  'hand_off',
  'install_at_hsr',
  'install_at_cv_raman',
  'courier'
];

export const FEEDBACK_STATUSES = [
  'feedback_pending',
  'positive_feedback',
  'negative_feedback',
  'review_requested',
  'review_received',
  'ugc_received',
  'issue_escalated'
];

export const COURIERS = [
  'delhivery',
  'fedex',
  'shree_maruti',
  'shiprocket',
  'dtdc',
  'usps',
  'aramex',
  'uniuni',
  'wix',
  'manual'
];

export const BOOKING_COURIERS = [
  {
    code: 'delhivery',
    name: 'Delhivery',
    enabled: true,
    services: [
      { code: 'express', name: 'Express', shippingMode: 'E' },
      { code: 'surface', name: 'Surface', shippingMode: 'S' },
      { code: 'reverse_pickup', name: 'Reverse pickup', shippingMode: 'E', reverse: true },
      { code: 'dlv_saver', name: 'International DLV Saver', internationalService: 'DLV Saver' },
      { code: 'deferred_express', name: 'International Deferred Express', internationalService: 'Deferred Express' }
    ]
  },
  { code: 'fedex', name: 'FedEx', enabled: false, services: [{ code: 'standard', name: 'Standard' }] },
  { code: 'shree_maruti', name: 'Shree Maruti', enabled: false, services: [{ code: 'standard', name: 'Standard' }] }
];

export const PAYMENT_STATUSES = [
  'PAID',
  'APPROVED',
  'NOT_PAID',
  'PENDING',
  'CANCELED',
  'PARTIALLY_REFUNDED',
  'FULLY_REFUNDED'
];

export const COMMUNICATION_TYPES = [
  ['tracking-link', 'Send tracking link'],
  ['installation-guide', 'Send installation guide'],
  ['installation-video', 'Send installation video'],
  ['feedback-request', 'Send feedback request'],
  ['review-request', 'Send review request']
];

export const ROLES = ['admin', 'operations_manager', 'packing_operator', 'support_operator', 'viewer'];

export const PACKING_ITEMS = [
  'Main module',
  'Bike-specific harness',
  'Handlebar switch',
  'Zip ties',
  'Manual / QR card',
  'Sticker',
  'Warranty card',
  'Packaging box',
  'Courier label attached'
];

export const STATUS_FILTERS = [
  ['new', 'New orders'],
  ['not_paid', 'Not paid'],
  ['details_verified', 'Details verified'],
  ['awaiting_packing', 'Awaiting packing'],
  ['packed', 'Packed'],
  ['shipment_booked', 'Shipment booked'],
  ['pickup_pending', 'Pickup pending'],
  ['in_transit', 'In transit'],
  ['out_for_delivery', 'Out for delivery'],
  ['delivered', 'Delivered'],
  ['installation_pending', 'Installation pending'],
  ['feedback_pending', 'Feedback pending'],
  ['issue_reported', 'Issue reported'],
  ['completed', 'Completed'],
  ['fulfilled_no_tracking', 'Fulfilled no tracking'],
  ['failed_delivery', 'Failed delivery'],
  ['rto_initiated', 'RTO initiated'],
  ['rto_delivered', 'RTO delivered'],
  ['lost_damaged', 'Lost / damaged'],
  ['pending_international', 'Pending international'],
  ['cancelled', 'Cancelled'],
  ['rto', 'RTO'],
  ['warranty_case', 'Warranty cases']
];
