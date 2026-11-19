<x-filament-panels::page>
    @php($context = $this->context())
    @unless($context['connected'])
        <p class="tc-alert">Connect your eBay seller account under eBay listings before validating or publishing.</p>
    @endunless

    @if(!$publication)
        <x-filament::section heading="1. Prepare your single-card listing">
            <p class="tc-muted">UK fixed-price, Good ’Til Cancelled, ungraded sports trading card single. The website SKU is retained. Nothing is published until you review the validated preview and confirm.</p>
            <form wire:submit="previewListing" class="tc-stack">
                {{ $this->form }}
                <x-filament::button type="submit" wire:loading.attr="disabled" wire:target="previewListing">Validate with eBay and preview</x-filament::button>
            </form>
        </x-filament::section>
    @else
        @php($preview = $publication['preview'])
        @php($item = $preview['input'])
        @php($template = $preview['template'])
        <x-filament::section heading="2. Review the eBay listing preview">
            <div class="tc-stack">
                <h2 style="font-size:1.3rem;font-weight:700">{{ $item['title'] }}</h2>
                <div style="display:flex;gap:12px;flex-wrap:wrap">
                    @foreach($item['photos'] as $photo)
                        <img src="{{ $photo }}" alt="Card photo for the proposed listing" style="max-width:240px;max-height:280px;object-fit:contain;border-radius:8px" />
                    @endforeach
                </div>
                <dl class="tc-info-grid">
                    <div><dt>SKU</dt><dd>{{ $item['sku'] }}</dd></div>
                    <div><dt>Price per single</dt><dd>£{{ number_format($item['price']/100, 2) }}</dd></div>
                    <div><dt>Copies</dt><dd>{{ $item['quantity'] }}</dd></div>
                    <div><dt>Category</dt><dd>Sports Trading Card Singles (261328)</dd></div>
                    <div><dt>Format</dt><dd>Buy It Now · Good ’Til Cancelled</dd></div>
                    <div><dt>Condition</dt><dd>Ungraded · {{ ['400010'=>'Near Mint or Better','400011'=>'Excellent','400012'=>'Very Good','400013'=>'Poor'][$item['condition']] }}</dd></div>
                    <div><dt>Dispatch location</dt><dd>{{ $template['location'] }} · {{ $template['postalCode'] }} · GB</dd></div>
                    <div><dt>Dispatch time</dt><dd>{{ $template['dispatchDays'] }} working days</dd></div>
                    <div><dt>Immediate payment requested</dt><dd>{{ $template['autoPay'] ? 'Yes' : 'No' }}</dd></div>
                </dl>
                <h3 style="font-weight:700">Description</h3>
                <p style="white-space:pre-wrap;overflow-wrap:anywhere">{{ $item['description'] }}</p>
                <h3 style="font-weight:700">Item specifics</h3>
                <dl class="tc-info-grid">
                    @foreach($item['specifics'] as $specific)<div><dt>{{ $specific['name'] }}</dt><dd>{{ $specific['value'] }}</dd></div>@endforeach
                </dl>
            </div>
        </x-filament::section>

        <x-filament::section heading="Selling policies and eBay validation">
            <div class="tc-stack">
                <p>Policies sourced from: {{ $preview['templateTitle'] }} · {{ $preview['templateId'] }}</p>
                @if($template['policies'])
                    <dl class="tc-info-grid">
                        @foreach(['payment'=>'Payment','shipping'=>'Delivery','returns'=>'Returns'] as $key=>$label)
                            <div><dt>{{ $label }} policy</dt><dd>{{ $template['policies'][$key]['name'] ?: 'Account policy' }} {{ $template['policies'][$key]['id'] ? '· '.$template['policies'][$key]['id'] : '(eBay account default)' }}</dd></div>
                        @endforeach
                    </dl>
                @else
                    <p>Uses the template’s UK flat-postage and returns settings below.</p>
                @endif
                @foreach($template['services'] as $service)
                    <p>{{ $service['name'] }} · {{ $service['free'] ? 'Free delivery' : '£'.number_format($service['cost']/100, 2) }} · additional copy £{{ number_format($service['additional']/100, 2) }}</p>
                @endforeach
                <p>Returns: {{ $template['returns']['accepted'] ?: 'See selected returns policy' }} {{ $template['returns']['within'] }} {{ $template['returns']['payer'] }}</p>
                <h3 style="font-weight:700">Estimated listing fees</h3>
                @forelse($preview['verification']['fees'] as $fee)
                    <p>{{ $fee['name'] }}: {{ $fee['currency'] }} {{ number_format($fee['pence']/100,2) }}</p>
                @empty
                    <p>eBay returned no fee breakdown.</p>
                @endforelse
                <p class="tc-muted">These are listing estimates. Final value fees and applicable Good ’Til Cancelled renewal fees are determined by eBay. No paid listing upgrades are selected.</p>
                @foreach($preview['verification']['warnings'] as $warning)<p class="tc-alert">{{ $warning }}</p>@endforeach
                <p class="tc-muted">Website and eBay can offer the same stock. Subsequent stock changes use the existing manual Update eBay stock action.</p>
            </div>
        </x-filament::section>

        <x-filament::section heading="3. Publication">
            <div class="tc-stack">
                @if($publication['status'] === 'preview')
                    <p>Preview expires at {{ \Illuminate\Support\Carbon::parse($publication['expiresAt'])->format('H:i T') }}. Stock, duplicate listings, policies and estimated fees will be checked again before publishing.</p>
                    <label><input type="checkbox" wire:model="confirmed" /> I reviewed this exact preview and approve publishing a live eBay listing with its applicable fees.</label>
                    @error('confirmed')<p class="tc-alert">{{ $message }}</p>@enderror
                    <div style="display:flex;gap:12px;flex-wrap:wrap">
                        <x-filament::button wire:click="publishListing" wire:loading.attr="disabled">Publish on eBay</x-filament::button>
                        <x-filament::button color="gray" wire:click="editDetails" wire:loading.attr="disabled">Edit details</x-filament::button>
                    </div>
                @elseif($publication['status'] === 'published')
                    <p>Listing confirmed and automatically matched to this inventory card.</p>
                    <a href="{{ $publication['url'] }}" target="_blank" rel="noopener noreferrer">View eBay listing {{ $publication['itemId'] }}</a>
                    <x-filament::button color="gray" wire:click="editDetails">Prepare another listing</x-filament::button>
                @else
                    <p class="tc-alert">{{ $publication['issue'] ?: 'Publication is still being checked. Do not create another listing for this SKU.' }}</p>
                    @if($publication['url'])<a href="{{ $publication['url'] }}" target="_blank" rel="noopener noreferrer">Inspect eBay listing {{ $publication['itemId'] }}</a>@endif
                    <x-filament::button wire:click="checkPublication('{{ $publication['draftId'] }}')" wire:loading.attr="disabled">Check publication</x-filament::button>
                @endif
            </div>
        </x-filament::section>
    @endif

    @if(count($context['drafts']))
        <x-filament::section heading="Recent previews and publication attempts" collapsible collapsed>
            <div class="tc-stack">
                @foreach($context['drafts'] as $draft)
                    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
                        <span>{{ $draft['sku'] }} · {{ ucfirst($draft['status']) }}</span>
                        <x-filament::button size="sm" color="gray" wire:click="loadDraft('{{ $draft['id'] }}')">Review</x-filament::button>
                    </div>
                @endforeach
            </div>
        </x-filament::section>
    @endif
</x-filament-panels::page>
