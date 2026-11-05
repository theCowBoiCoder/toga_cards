<?php

namespace Tests\Feature;

use App\Filament\Pages\Inventory;
use App\Models\AuditEvent;
use App\Models\User;
use App\Services\InventoryClient;
use Filament\Auth\Pages\Login;
use Filament\Facades\Filament;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;
use Tests\TestCase;

class AdminAccessTest extends TestCase
{
    use RefreshDatabase;

    private function snapshot(): array
    {
        return ['cards' => [['id' => 1, 'player' => 'Test Player', 'club' => 'Arsenal', 'number' => '24', 'season' => '2026/27', 'collection' => 'Topps', 'variant' => 'Base', 'condition' => 'Near mint', 'stock' => 4, 'stock_cost' => 200]], 'sales' => [], 'sets' => []];
    }

    private function shopSnapshot(): array
    {
        return [
            'products' => [[...$this->snapshot()['cards'][0], 'price' => null, 'photo' => '', 'available' => 0]],
            'listings' => [], 'orders' => [],
            'stockSync' => ['targets' => [], 'jobs' => [], 'enabled' => true, 'paused' => false],
        ];
    }

    public function test_guests_are_sent_to_login_and_cannot_register_or_export(): void
    {
        Http::preventStrayRequests();
        $this->get('/admin/inventory')->assertRedirect('/admin/login');
        $this->get('/admin/login')->assertOk()->assertSee('Toga Cards');
        $this->get('/admin/register')->assertNotFound();
        $this->get('/admin/export/inventory')->assertRedirect('/admin/login');
        $this->get('/admin/website')->assertRedirect('/admin/login');
        Http::assertNothingSent();
    }

    public function test_non_admin_accounts_cannot_use_the_panel_or_inventory_client(): void
    {
        Http::preventStrayRequests();
        $this->actingAs(User::factory()->create(['is_admin' => false]));
        $this->get('/admin/inventory')->assertForbidden();
        $this->get('/admin/export/inventory')->assertForbidden();
        $this->get('/admin/website')->assertForbidden();
        Http::assertNothingSent();
    }

    public function test_inventory_action_uses_private_api_and_records_an_audit_without_secrets(): void
    {
        $this->actingAs(User::factory()->create(['is_admin' => true]));
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        Http::preventStrayRequests();
        Http::fake([
            'http://127.0.0.1:3001/api/inventory' => Http::response($this->snapshot()),
            'http://127.0.0.1:3001/api/admin/shop' => Http::response($this->shopSnapshot()),
        ]);
        Livewire::test(Inventory::class)->assertSee('Test Player')
            ->callTableAction('receive', '1', data: ['quantity' => 2, 'unitCost' => 1.25, 'date' => '2026-11-05'])
            ->assertHasNoTableActionErrors();
        Http::assertSent(fn ($request): bool => $request->method() === 'POST' && $request->hasHeader('X-Toga-Admin-Key', config('inventory.key')) && $request['cardId'] === 1 && $request['quantity'] === 2 && $request['unitCost'] === 125);
        $event = AuditEvent::query()->firstOrFail();
        $this->assertSame('succeeded', $event->outcome);
        $this->assertSame(2, $event->parameters['quantity']);
        $this->assertStringNotContainsString(config('inventory.key'), $event->toJson());
    }

    public function test_upstream_rejection_is_reported_and_never_retried(): void
    {
        $this->actingAs(User::factory()->create(['is_admin' => true]));
        Http::preventStrayRequests();
        Http::fake(['http://127.0.0.1:3001/api/inventory' => Http::response(['statusMessage' => 'There is not enough stock for this sale.'], 400)]);
        try {
            app(InventoryClient::class)->mutate('/api/inventory', ['action' => 'sale', 'cardId' => 1, 'quantity' => 10]);
            $this->fail('The stock rejection was not surfaced.');
        } catch (ValidationException $exception) {
            $this->assertStringContainsString('not enough stock', implode(' ', $exception->errors()['service']));
        }
        Http::assertSentCount(1);
        $this->assertDatabaseHas('audit_events', ['outcome' => 'rejected', 'status_code' => 400]);
    }

    public function test_unknown_network_outcome_is_not_retried_or_reported_as_a_success(): void
    {
        $this->actingAs(User::factory()->create(['is_admin' => true]));
        Http::preventStrayRequests();
        Http::fake(['http://127.0.0.1:3001/api/inventory' => Http::failedConnection()]);
        try {
            app(InventoryClient::class)->mutate('/api/inventory', ['action' => 'stock', 'cardId' => 1, 'quantity' => 2]);
            $this->fail('Unknown network outcome was not surfaced.');
        } catch (ValidationException $exception) {
            $this->assertStringContainsString('Refresh stock', implode(' ', $exception->errors()['service']));
        }
        $this->assertDatabaseHas('audit_events', ['outcome' => 'unknown']);
    }

    public function test_oauth_cookie_reaches_browser_without_laravel_encryption(): void
    {
        $this->actingAs(User::factory()->create(['is_admin' => true]));
        $state = str_repeat('a', 64);
        Http::preventStrayRequests();
        Http::fake(['http://127.0.0.1:3001/api/ebay/action' => Http::response(['authorizationUrl' => 'https://auth.ebay.com/oauth2/authorize?state='.$state], 200, ['Set-Cookie' => 'ebay_oauth_state='.$state.'; Path=/api/ebay; HttpOnly; SameSite=Lax'])]);
        $response = $this->post('/admin/ebay/connect');
        $response->assertRedirect('https://auth.ebay.com/oauth2/authorize?state='.$state);
        $cookies = collect($response->headers->getCookies())->keyBy(fn ($cookie): string => $cookie->getName());
        $this->assertSame($state, $cookies['ebay_oauth_state']->getValue());
        $this->assertTrue($cookies['ebay_oauth_state']->isHttpOnly());
    }

    public function test_bootstrap_never_resets_an_existing_account_or_password(): void
    {
        $password = 'Initial-synthetic-password-123';
        putenv('ADMIN_PASSWORD='.$password);
        try {
            $this->artisan('toga:bootstrap-admin')->assertSuccessful();
            $owner = User::query()->firstOrFail();
            $owner->update(['password' => 'New-synthetic-password-456', 'email' => 'owner@example.test']);
            $this->artisan('toga:bootstrap-admin')->assertSuccessful();
            $this->assertSame(1, User::query()->count());
            $this->assertTrue(Hash::check('New-synthetic-password-456', $owner->fresh()->password));
        } finally {
            putenv('ADMIN_PASSWORD');
        }
    }

    public function test_authenticator_secrets_are_encrypted_and_hidden(): void
    {
        $user = User::factory()->create(['is_admin' => true]);
        $user->saveAppAuthenticationSecret('SYNTHETICTOTPSECRET');
        $user->saveAppAuthenticationRecoveryCodes(['synthetic-recovery']);
        $this->assertNotSame('SYNTHETICTOTPSECRET', $user->getRawOriginal('app_authentication_secret'));
        $this->assertSame('SYNTHETICTOTPSECRET', $user->fresh()->getAppAuthenticationSecret());
        $this->assertArrayNotHasKey('app_authentication_secret', $user->toArray());
        $this->assertArrayNotHasKey('app_authentication_recovery_codes', $user->toArray());
    }

    public function test_user_controlled_inventory_content_is_escaped(): void
    {
        $this->actingAs(User::factory()->create(['is_admin' => true]));
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        $snapshot = $this->snapshot();
        $snapshot['cards'][0]['player'] = '<script>alert("x")</script>';
        Http::preventStrayRequests();
        Http::fake([
            'http://127.0.0.1:3001/api/inventory' => Http::response($snapshot),
            'http://127.0.0.1:3001/api/admin/shop' => Http::response($this->shopSnapshot()),
        ]);
        $html = Livewire::test(Inventory::class)->html();
        $this->assertStringContainsString('&lt;script&gt;', $html);
        $this->assertStringNotContainsString('<script>alert("x")</script>', $html);
    }

    public function test_admin_can_log_in_with_a_persistent_laravel_session(): void
    {
        $user = User::factory()->create(['is_admin' => true, 'password' => 'Synthetic-login-password-123']);
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        Livewire::test(Login::class)
            ->fillForm(['email' => $user->email, 'password' => 'Synthetic-login-password-123'])
            ->call('authenticate');
        $this->assertAuthenticatedAs($user);
    }

    public function test_website_price_and_allocation_are_sent_to_stock_engine_in_pence(): void
    {
        $this->actingAs(User::factory()->create(['is_admin' => true]));
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        Storage::fake('public');
        $product = [...$this->snapshot()['cards'][0], 'price' => null, 'photo' => '', 'available' => 0];
        Http::preventStrayRequests();
        Http::fake([
            'http://127.0.0.1:3001/api/inventory' => Http::response($this->snapshot()),
            'http://127.0.0.1:3001/api/admin/shop' => Http::response(['stockSync' => ['targets' => [], 'enabled' => true], 'products' => [$product], 'listings' => [], 'orders' => []]),
        ]);
        Livewire::test(Inventory::class)->callTableAction('listing', '1', data: ['price' => 1.99, 'quantity' => 2, 'condition' => 'Near mint', 'image' => null, 'photo_url' => 'https://example.test/card.jpg', 'stockConfirmed' => true])->assertHasNoTableActionErrors();
        Http::assertSent(fn ($request): bool => $request->method() === 'POST' && str_ends_with($request->url(), '/api/admin/shop') && $request['price'] === 199 && $request['quantity'] === 2 && $request['photo'] === 'https://example.test/card.jpg');
    }

    public function test_uploaded_card_photo_is_stored_and_passed_as_a_public_image_path(): void
    {
        $this->actingAs(User::factory()->create(['is_admin' => true]));
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        Storage::fake('public');
        $product = [...$this->snapshot()['cards'][0], 'price' => null, 'photo' => '', 'available' => 0];
        Http::preventStrayRequests();
        Http::fake([
            'http://127.0.0.1:3001/api/inventory' => Http::response($this->snapshot()),
            'http://127.0.0.1:3001/api/admin/shop' => Http::response(['stockSync' => ['targets' => []], 'products' => [$product], 'listings' => [], 'orders' => []]),
        ]);
        $image = UploadedFile::fake()->createWithContent('card.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII='));
        Livewire::test(Inventory::class)->callTableAction('listing', '1', data: ['price' => 1.99, 'quantity' => 2, 'condition' => 'Near mint', 'image' => $image, 'photo_url' => '', 'stockConfirmed' => true])->assertHasNoTableActionErrors();
        Http::assertSent(function ($request): bool {
            if ($request->method() !== 'POST') {
                return false;
            }
            $path = $request['photo'];
            $this->assertMatchesRegularExpression('~^/storage/cards/[A-Za-z0-9_-]+\\.png$~', $path);
            Storage::disk('public')->assertExists(substr($path, 9));

            return true;
        });
    }

    public function test_inventory_combines_owned_stock_and_pending_website_listing_without_publishing_it(): void
    {
        $this->actingAs(User::factory()->create(['is_admin' => true]));
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        $shop = $this->shopSnapshot();
        $shop['products'][0]['price'] = 199;
        $shop['stockSync']['targets'] = [['card_id' => 1, 'quantity' => 2]];
        $shop['stockSync']['jobs'] = [['card_id' => 1, 'error' => 'Match unmapped eBay listings before releasing stock.']];
        Http::preventStrayRequests();
        Http::fake([
            'http://127.0.0.1:3001/api/inventory' => Http::response($this->snapshot()),
            'http://127.0.0.1:3001/api/admin/shop' => Http::response($shop),
        ]);
        Livewire::test(Inventory::class)
            ->assertTableColumnStateSet('stock', 4, '1')
            ->assertTableColumnStateSet('stock_cost', 200, '1')
            ->assertTableColumnStateSet('price', 199, '1')
            ->assertTableColumnStateSet('available', 0, '1')
            ->assertTableColumnStateSet('website_status', 'Needs review', '1')
            ->assertSee('Match unmapped eBay listings before releasing stock.')
            ->assertTableActionExists('receive')->assertTableActionExists('listing');
        Http::assertNotSent(fn ($request): bool => $request->method() === 'POST');
        $this->assertDatabaseCount('audit_events', 0);
    }

    public function test_unified_shop_editor_rejects_more_copies_than_owned_without_sending_a_write(): void
    {
        $this->actingAs(User::factory()->create(['is_admin' => true]));
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        Storage::fake('public');
        Http::preventStrayRequests();
        Http::fake([
            'http://127.0.0.1:3001/api/inventory' => Http::response($this->snapshot()),
            'http://127.0.0.1:3001/api/admin/shop' => Http::response($this->shopSnapshot()),
        ]);
        Livewire::test(Inventory::class)->callTableAction('listing', '1', data: [
            'price' => 1.99, 'quantity' => 5, 'condition' => 'Near mint',
            'image' => null, 'photo_url' => '', 'stockConfirmed' => true,
        ])->assertHasTableActionErrors(['quantity' => 'max']);
        Http::assertNotSent(fn ($request): bool => $request->method() === 'POST');
        $this->assertDatabaseCount('audit_events', 0);
    }

    public function test_old_website_listing_url_redirects_to_the_combined_inventory_page(): void
    {
        $this->actingAs(User::factory()->create(['is_admin' => true]));
        Http::preventStrayRequests();
        $this->get('/admin/website')->assertRedirect('/admin/inventory');
        Http::assertNothingSent();
    }
}
