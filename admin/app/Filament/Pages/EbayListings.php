<?php

namespace App\Filament\Pages;

use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Tables\Columns\TextColumn;

class EbayListings extends RecordsPage
{
    use Concerns\ManagesWebsiteListing;
    protected static string|\UnitEnum|null $navigationGroup = 'eBay';

    protected static string|\BackedEnum|null $navigationIcon = 'heroicon-o-tag';

    protected ?string $subheading = 'Connect your seller account and match listings to your inventory.';

    protected static ?string $title = 'eBay listings';

    protected static ?string $navigationLabel = 'eBay listings';

    protected static ?int $navigationSort = 50;

    protected string $view = 'filament.pages.ebay-listings';

    public function connection(): array
    {
        return $this->client()->get('/api/ebay');
    }

    protected function sourceRows(): array
    {
        $rows = collect($this->connection()['listings'])->filter(fn (array $row): bool => $row['active']);
        $cards = collect();
        $products = collect();
        $listings = collect();
        if ($rows->contains(fn (array $row): bool => ! empty($row['cardId']))) {
            $cards = collect($this->client()->get('/api/inventory')['cards'])->keyBy('id');
            $shop = $this->client()->get('/api/admin/shop');
            $products = collect($shop['products'])->keyBy('id');
            $listings = collect($shop['listings'])->keyBy('card_id');
        }

        return $rows->map(function (array $row) use ($cards, $products, $listings): array {
            $card = $cards[$row['cardId']] ?? [];
            $product = $products[$row['cardId']] ?? [];

            return [...$row, 'id' => hash('sha256', $row['key']), 'match' => $row['cardId'] ? 'Matched' : 'Needs matching',
                'shop_card_id' => $card['id'] ?? null, 'shop_listed' => isset($listings[$row['cardId']]),
                'website_sku' => $product['sku'] ?? null, 'player' => $card['player'] ?? '', 'number' => $card['number'] ?? '',
                'condition' => $card['condition'] ?? 'Not assessed', 'stock' => $card['stock'] ?? 0,
                'price' => $product['price'] ?? null, 'photo' => $product['photo'] ?? '',
                'requested' => $listings[$row['cardId']]['quantity'] ?? 0];
        })->all();
    }

    protected function columns(): array
    {
        return [TextColumn::make('title')->wrap(), TextColumn::make('sku')->label('eBay SKU'), TextColumn::make('website_sku')->label('Website SKU')->copyable()->placeholder('Match a single card first'), TextColumn::make('available')->label('eBay available'), TextColumn::make('match')->badge(), TextColumn::make('cardId')->label('Inventory ID')->placeholder('Unmatched')];
    }

    protected function rowActions(): array
    {
        return [$this->shopAction(), $this->adminAction('match')->schema([Select::make('cardId')->label('Exact inventory card')->searchable()->getSearchResultsUsing(fn (string $search): array => $this->cardOptions($search))->required()])->action(fn (array $data, array $record) => $this->perform('/api/ebay/action', ['action' => 'map', 'key' => $record['key'], 'cardId' => $data['cardId']], 'Listing matched'))];
    }

    protected function getHeaderActions(): array
    {
        return [$this->adminAction('sync')->label('Import eBay now')->action(fn () => $this->perform('/api/ebay/action', ['action' => 'sync'], 'eBay imported')),
            $this->adminAction('settings')->label('OAuth settings')->fillForm(fn (): array => ['ruName' => $this->connection()['ruName'] ?? ''])->schema([TextInput::make('ruName')->label('Production RuName')->required()->maxLength(300)])->action(fn (array $data) => $this->perform('/api/ebay/action', ['action' => 'settings', ...$data], 'OAuth settings saved')),
            $this->adminAction('finishStocktake')->label('Finish stocktake')->requiresConfirmation()->modalDescription('Enable automatic deductions for newly paid, mapped eBay orders after completing the stock review.')->action(fn () => $this->perform('/api/ebay/action', ['action' => 'automatic', 'enabled' => true], 'Automatic order deductions enabled'))];
    }
}
