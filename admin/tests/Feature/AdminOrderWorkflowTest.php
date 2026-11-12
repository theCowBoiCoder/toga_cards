<?php

namespace Tests\Feature;

use App\Filament\Pages\Orders;
use App\Models\User;
use Filament\Facades\Filament;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Livewire\Livewire;
use Tests\TestCase;

class AdminOrderWorkflowTest extends TestCase
{
    use RefreshDatabase;

    public function test_staff_order_actions_send_tracking_refunds_and_inspected_return_totals_to_the_private_service(): void
    {
        $this->actingAs(User::factory()->create(['is_admin' => true, 'account_type' => 'staff']));
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        $order = ['id' => '919d8b28-cc96-49bc-a297-101d94565189', 'created' => '2026-11-12T12:00:00Z', 'email' => 'customer@example.test', 'status' => 'paid', 'total' => 500, 'shipping' => 100, 'refunded' => 0, 'dispatched_at' => null, 'tracking_reference' => '', 'returnRequest' => ['status' => 'received', 'reason' => 'Wrong card', 'response' => 'Received'], 'refunds' => [], 'items' => [['card_id' => 1, 'player' => 'Test Player', 'number' => '1', 'variant' => 'Base', 'quantity' => 2, 'returned' => 0, 'price' => 200]]];
        Http::preventStrayRequests();
        Http::fake([
            'http://127.0.0.1:3001/api/admin/shop' => Http::response(['orders' => [$order]]),
            'http://127.0.0.1:3001/api/admin/dispatch' => Http::response(['saved' => true]),
            'http://127.0.0.1:3001/api/admin/refund' => Http::response(['status' => 'pending']),
            'http://127.0.0.1:3001/api/admin/returns' => Http::response(['saved' => true]),
        ]);
        Livewire::test(Orders::class)
            ->callTableAction('dispatch', $order['id'], data: ['tracking' => 'TRACK-123', 'carrier' => 'Royal Mail', 'trackingUrl' => 'https://www.royalmail.com/track-your-item'])
            ->assertHasNoTableActionErrors();
        Http::assertSent(fn ($request): bool => str_ends_with($request->url(), '/dispatch') && $request['tracking'] === 'TRACK-123' && $request['carrier'] === 'Royal Mail');
        Livewire::test(Orders::class)
            ->callTableAction('refund', $order['id'], data: ['requestId' => '9da23764-1a80-4a9d-ac9b-38b47ec23270', 'amount' => 1.50, 'reason' => 'Partial refund', 'confirmed' => true])
            ->assertHasNoTableActionErrors();
        Http::assertSent(fn ($request): bool => str_ends_with($request->url(), '/refund') && $request['amount'] === 150 && $request['requestId'] === '9da23764-1a80-4a9d-ac9b-38b47ec23270');
        Livewire::test(Orders::class)
            ->callTableAction('restockReturn', $order['id'], data: ['cardId' => '1', 'quantity' => 2, 'inspected' => true])
            ->assertHasNoTableActionErrors();
        Http::assertSent(fn ($request): bool => str_ends_with($request->url(), '/returns') && $request['action'] === 'restock' && $request['quantity'] === 2 && $request['cardId'] === 1);
        $this->assertDatabaseCount('audit_events', 3);
    }
}
