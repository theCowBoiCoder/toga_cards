<?php

namespace Tests\Feature;

use App\Filament\Pages\Emails;
use App\Models\User;
use App\Services\InventoryClient;
use Filament\Facades\Filament;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Livewire\Livewire;
use Tests\TestCase;

class OrderEmailsTest extends TestCase
{
    use RefreshDatabase;

    public function test_staff_can_view_delivery_status_and_retry_failed_emails(): void
    {
        $this->actingAs(User::factory()->create(['is_admin' => true, 'account_type' => 'staff']));
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        Http::preventStrayRequests();
        Http::fake(['http://127.0.0.1:3001/api/admin/emails' => Http::response([
            'ready' => true, 'message' => 'SMTP configured.',
            'emails' => [['id' => 'email-1', 'order_id' => 'order-1', 'kind' => 'order-paid',
                'audience' => 'customer', 'status' => 'failed', 'attempts' => 8,
                'created' => now()->toIso8601String(), 'sent_at' => null, 'error_code' => 'EAUTH']],
        ])]);
        $this->withoutExceptionHandling()->get('/admin/emails')->assertOk()->assertSee('SMTP configured.')->assertSee('EAUTH');
        Livewire::test(Emails::class)->callTableAction('retry', 'email-1')->assertHasNoTableActionErrors();
        Http::assertSent(fn ($request): bool => $request->method() === 'POST' && $request['id'] === 'email-1');
        $this->assertDatabaseHas('audit_events', ['operation' => '/api/admin/emails:update', 'outcome' => 'succeeded']);
    }

    public function test_customer_accounts_cannot_read_or_retry_order_emails(): void
    {
        $this->actingAs(User::factory()->create(['is_admin' => false, 'account_type' => 'customer']));
        Http::preventStrayRequests();
        $this->get('/admin/emails')->assertForbidden();
        $this->expectException(AuthorizationException::class);
        app(InventoryClient::class)->mutate('/api/admin/emails', ['id' => 'email-1']);
    }
}
