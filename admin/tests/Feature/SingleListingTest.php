<?php

namespace Tests\Feature;

use App\Filament\Pages\EbayListings;
use App\Filament\Pages\Inventory;
use App\Models\User;
use Filament\Facades\Filament;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Livewire\Livewire;
use Tests\TestCase;

class SingleListingTest extends TestCase
{
    use RefreshDatabase;

    private function prepare(bool $listed = false, bool $matched = true): void
    {
        $this->actingAs(User::factory()->create(['is_admin' => true, 'account_type' => 'staff']));
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        $card = ['id' => 1, 'player' => 'Test Single', 'club' => 'Arsenal', 'number' => '24',
            'season' => '2026/27', 'collection' => 'Topps', 'variant' => 'Base', 'condition' => 'Near mint', 'stock' => 4, 'stock_cost' => 200];
        Http::preventStrayRequests();
        Http::fake([
            'http://127.0.0.1:3001/api/inventory' => Http::response(['cards' => [$card], 'sales' => [], 'sets' => []]),
            'http://127.0.0.1:3001/api/admin/shop' => Http::response([
                'products' => [[...$card, 'sku' => 'TC-S-000001', 'price' => $listed ? 199 : null, 'photo' => '', 'available' => $listed ? 2 : 0]],
                'listings' => $listed ? [['card_id' => 1, 'quantity' => 2]] : [], 'orders' => [], 'stockSync' => ['targets' => []],
            ]),
            'http://127.0.0.1:3001/api/ebay' => Http::response(['connected' => true, 'configured' => true,
                'ruName' => 'synthetic', 'lastSync' => null, 'lastError' => null, 'listings' => [[
                'key' => 'listing-key', 'active' => true, 'cardId' => $matched ? 1 : null, 'title' => 'A single card',
                'sku' => 'EBAY-123', 'available' => 4,
            ]]]),
        ]);
    }

    public function test_inventory_can_list_a_single_with_automatic_sku_and_create_only_semantics(): void
    {
        $this->prepare();
        Livewire::test(Inventory::class)->assertSee('TC-S-000001')->assertSee('List single on website')
            ->callTableAction('listing', '1', data: ['price' => 1.99, 'quantity' => 2,
                'condition' => 'Near mint', 'stockConfirmed' => true, 'photo_url' => '', 'image' => null])
            ->assertHasNoTableActionErrors();
        Http::assertSent(fn ($request): bool => $request->method() === 'POST' && $request['action'] === 'create-single'
            && $request['cardId'] === 1 && $request['price'] === 199 && $request['quantity'] === 2);
    }

    public function test_matched_ebay_listing_uses_the_inventory_id_and_keeps_ebay_and_website_skus_distinct(): void
    {
        $this->prepare();
        Livewire::test(EbayListings::class)->assertSee('EBAY-123')->assertSee('TC-S-000001')
            ->callTableAction('listing', hash('sha256', 'listing-key'), data: ['price' => 2.49, 'quantity' => 1,
                'condition' => 'Near mint', 'stockConfirmed' => true, 'photo_url' => '', 'image' => null])
            ->assertHasNoTableActionErrors();
        Http::assertSent(fn ($request): bool => $request->method() === 'POST' && $request->url() === 'http://127.0.0.1:3001/api/admin/shop'
            && $request['cardId'] === 1 && $request['action'] === 'create-single' && $request['price'] === 249);
        Http::assertNotSent(fn ($request): bool => $request->method() === 'POST' && str_contains($request->url(), '/api/ebay/'));
    }

    public function test_unmatched_ebay_listing_must_be_matched_before_it_can_be_listed_as_a_single(): void
    {
        $this->prepare(matched: false);
        Livewire::test(EbayListings::class)->assertTableActionHidden('listing', hash('sha256', 'listing-key'));
    }

    public function test_existing_single_opens_edit_shop_and_can_be_taken_off_sale_without_changing_identity(): void
    {
        $this->prepare(listed: true);
        Livewire::test(Inventory::class)->assertSee('Edit shop')
            ->callTableAction('listing', '1', data: ['price' => 1.99, 'quantity' => 0,
                'condition' => 'Near mint', 'stockConfirmed' => false, 'photo_url' => '', 'image' => null])
            ->assertHasNoTableActionErrors();
        Http::assertSent(fn ($request): bool => $request->method() === 'POST' && $request['action'] === 'update' && $request['quantity'] === 0);
    }
}
